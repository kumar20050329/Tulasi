document.addEventListener('DOMContentLoaded', async () => {
    // --- IndexedDB Setup ---
    const DB_NAME = 'LibraryDB';
    // NEW: Incremented DB version to trigger onupgradeneeded for the new table
    const DB_VERSION = 2;

    let db;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                // Users Table
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'userId', autoIncrement: true });
                    userStore.createIndex('username', 'username', { unique: true });
                    // Initial Data
                    userStore.add({ username: 'admin', password: 'admin', role: 'admin' });
                    userStore.add({ username: 'thulasi', password: '123', role: 'student' });
                    userStore.add({ username: 'hari', password: '123', role: 'student' });
                }
                // Books Table
                if (!db.objectStoreNames.contains('books')) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'bookId', autoIncrement: true });
                    bookStore.createIndex('category', 'category', { unique: false });
                    // Initial Data
                    bookStore.add({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', category: 'Fiction', available: true, borrowerId: null });
                    bookStore.add({ title: 'Cosmos', author: 'Carl Sagan', category: 'Science', available: true, borrowerId: null });
                    bookStore.add({ title: 'Sapiens', author: 'Yuval Noah Harari', category: 'History', available: false, borrowerId: 2 });
                    for(let i = 1; i <= 10; i++) {
                        bookStore.add({ title: `Fiction Book ${i}`, author: `Author ${i}`, category: 'Fiction', available: true, borrowerId: null });
                    }
                }
                // NEW: Transactions Table as per requirements
                if (!db.objectStoreNames.contains('transactions')) {
                    const txnStore = db.createObjectStore('transactions', { keyPath: 'txnId', autoIncrement: true });
                    txnStore.createIndex('bookId', 'bookId', { unique: false });
                    txnStore.createIndex('userId', 'userId', { unique: false });
                    // Add a sample transaction for the pre-borrowed book
                    txnStore.add({ bookId: 3, userId: 2, borrowDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), returnDate: null });
                }
            };
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
        });
    }

    // --- UI Elements ---
    const body = document.body;
    const pages = { login: document.getElementById('login-page'), dashboard: document.getElementById('dashboard-page'), addBook: document.getElementById('add-book-page') };
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    const addBookBtn = document.getElementById('add-book-btn');
    const bookTableBody = document.getElementById('book-table-body');
    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');
    const addBookForm = document.getElementById('add-book-form');
    const cancelAddBookBtn = document.getElementById('cancel-add-book');
    const confirmationDialog = document.getElementById('confirmation-dialog');
    const toast = document.getElementById('toast');
    const welcomeMessage = document.getElementById('welcome-message');
    // Pagination UI
    const paginationControls = document.getElementById('pagination-controls');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');
    // NEW: History Modal UI
    const historyModal = document.getElementById('history-modal');
    const historyModalTitle = document.getElementById('history-modal-title');
    const historyModalBody = document.getElementById('history-modal-body');
    const historyModalCloseBtn = document.getElementById('history-modal-close');


    // --- Global State ---
    let currentUser = null;
    let allBooks = [];
    let confirmActionCallback = null;
    let currentPage = 1;
    const BOOKS_PER_PAGE = 5;

    // --- Utility & DB Functions ---
    const operateOnDB = (storeName, mode, callback) => new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction(storeName, mode);
            const store = transaction.objectStore(storeName);
            const request = callback(store);
            transaction.oncomplete = () => resolve(request ? request.result : undefined);
            transaction.onerror = () => reject(transaction.error);
        } catch (error) { reject(error); }
    });

    const getAll = (store) => operateOnDB(store, 'readonly', s => s.getAll());
    const get = (store, key) => operateOnDB(store, 'readonly', s => s.get(key));
    const add = (store, data) => operateOnDB(store, 'readwrite', s => s.add(data));
    const put = (store, data) => operateOnDB(store, 'readwrite', s => s.put(data));
    const del = (store, key) => operateOnDB(store, 'readwrite', s => s.delete(key));
    const showPage = (pageName) => Object.values(pages).forEach(p => p.classList.toggle('active', p === pages[pageName]));
    
    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.className = 'show';
        toast.style.backgroundColor = type === 'success' ? 'var(--success-color)' : 'var(--danger-color)';
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // --- Core Functions ---
    // NEW: Populate category filter dynamically
    async function populateCategories() {
        const categories = [...new Set(allBooks.map(book => book.category))].sort();
        categoryFilter.innerHTML = '<option value="">All Categories</option>';
        categories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            option.textContent = cat;
            categoryFilter.appendChild(option);
        });
    }

    function renderBooks() {
        const searchTerm = searchInput.value.toLowerCase();
        const category = categoryFilter.value;
        const filteredBooks = allBooks.filter(book =>
            (book.title.toLowerCase().includes(searchTerm) || (book.author && book.author.toLowerCase().includes(searchTerm))) &&
            (category === '' || book.category === category)
        );

        const totalPages = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
        currentPage = Math.min(currentPage, totalPages || 1);
        const startIndex = (currentPage - 1) * BOOKS_PER_PAGE;
        const paginatedBooks = filteredBooks.slice(startIndex, startIndex + BOOKS_PER_PAGE);

        bookTableBody.innerHTML = '';
        document.getElementById('no-books-message').style.display = filteredBooks.length ? 'none' : 'block';
        paginationControls.style.display = totalPages > 1 ? 'flex' : 'none';
        
        paginatedBooks.forEach((book, index) => {
            const row = bookTableBody.insertRow();
            row.innerHTML = `<td>${startIndex + index + 1}</td><td>${book.title}</td><td>${book.author}</td><td>${book.category}</td>
                <td><span class="status-badge ${book.available ? 'status-available' : 'status-borrowed'}">
                <i class="fas fa-${book.available ? 'check-circle' : 'times-circle'}"></i>${book.available ? 'Available' : 'Borrowed'}</span></td>
                <td class="table-actions">${generateActionButtons(book)}</td>`;
        });
        
        pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }
    
    // NEW: Updated to include a "View History" button for admins.
    function generateActionButtons(book) {
        if (currentUser.role === 'admin') {
            return `<button class="btn btn-secondary view-history-btn" data-book-id="${book.bookId}" title="View History"><i class="fas fa-history"></i></button>
                    <button class="btn btn-danger delete-book-btn" data-book-id="${book.bookId}" title="Delete Book"><i class="fas fa-trash"></i></button>`;
        }
        if (currentUser.role === 'student') {
            if (book.available) return `<button class="btn btn-primary borrow-btn" data-book-id="${book.bookId}">Borrow</button>`;
            if (book.borrowerId === currentUser.userId) return `<button class="btn btn-secondary return-btn" data-book-id="${book.bookId}">Return</button>`;
        }
        return '—';
    }

    async function loadBooks() {
        allBooks = await getAll('books');
        await populateCategories();
        renderBooks();
    }
    
    // --- Event Handlers ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;
        const loginError = document.getElementById('login-error');

        const users = await getAll('users');
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            currentUser = user;
            welcomeMessage.textContent = `Welcome, ${currentUser.username}!`;
            addBookBtn.style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
            body.classList.add('dashboard-view');
            body.classList.remove('login-view');
            await loadBooks();
            showPage('dashboard');
            showToast('Login successful!');
            loginError.textContent = '';
        } else {
            loginError.textContent = 'Invalid username or password.';
        }
    });

    logoutBtn.addEventListener('click', () => {
        currentUser = null;
        loginForm.reset();
        document.getElementById('login-error').textContent = '';
        body.classList.remove('dashboard-view');
        body.classList.add('login-view');
        showPage('login');
    });
    
    const triggerRender = () => { currentPage = 1; renderBooks(); };
    searchInput.addEventListener('input', triggerRender);
    categoryFilter.addEventListener('change', triggerRender);

    addBookBtn.addEventListener('click', () => showPage('addBook'));
    cancelAddBookBtn.addEventListener('click', () => showPage('dashboard'));
    
    // NEW: Added enhanced form validation
    addBookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = e.target['new-book-title'].value.trim();
        const author = e.target['new-book-author'].value.trim();
        const category = e.target['new-book-category'].value.trim();

        if (title.length < 3 || author.length < 3 || category.length < 3) {
            showToast('All fields must be at least 3 characters long.', 'danger');
            return;
        }

        await add('books', { title, author, category, available: true, borrowerId: null });
        showToast('Book added successfully!');
        addBookForm.reset();
        await loadBooks();
        showPage('dashboard');
    });

    // NEW: Updated event listener to handle history, borrow, return, and delete actions.
    bookTableBody.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const bookId = parseInt(button.dataset.bookId);

        if (button.classList.contains('delete-book-btn')) {
            showConfirmation('Are you sure you want to delete this book?', async () => {
                await del('books', bookId);
                showToast('Book deleted.', 'danger');
                loadBooks();
            });
        } else if (button.classList.contains('borrow-btn')) {
            showConfirmation('Are you sure you want to borrow this book?', async () => {
                const book = await get('books', bookId);
                book.available = false;
                book.borrowerId = currentUser.userId;
                await put('books', book);
                await add('transactions', { bookId, userId: currentUser.userId, borrowDate: new Date(), returnDate: null});
                showToast('Book borrowed successfully!');
                loadBooks();
            });
        } else if (button.classList.contains('return-btn')) {
            showConfirmation('Are you sure you want to return this book?', async () => {
                const book = await get('books', bookId);
                book.available = true;
                book.borrowerId = null;
                await put('books', book);
                // Update the corresponding transaction
                await operateOnDB('transactions', 'readwrite', store => {
                    const index = store.index('bookId');
                    const request = index.getAll(bookId);
                    request.onsuccess = () => {
                        const openTxn = request.result.find(t => t.returnDate === null);
                        if (openTxn) {
                            openTxn.returnDate = new Date();
                            store.put(openTxn);
                        }
                    };
                });
                showToast('Book returned successfully!');
                loadBooks();
            });
        } else if (button.classList.contains('view-history-btn')) {
            await showHistory(bookId);
        }
    });
    
    // NEW: Function to display the borrow history for a book
    async function showHistory(bookId) {
        const book = await get('books', bookId);
        const transactions = await operateOnDB('transactions', 'readonly', store => store.index('bookId').getAll(bookId));
        const users = await getAll('users');
        const userMap = new Map(users.map(user => [user.userId, user.username]));

        historyModalTitle.textContent = `History for "${book.title}"`;

        if (transactions.length === 0) {
            historyModalBody.innerHTML = '<p>No borrow history found for this book.</p>';
        } else {
            
           let tableHTML = `<table><thead><tr><th>User</th><th>Book Borrow Count</th><th>Borrow Date</th><th>Return Date</th><th>numofDays</th></tr></thead><tbody>`;
 
// Step 1: Build a user borrow count map
const borrowCountMap = new Map();
transactions.forEach(txn => {
    const userId = txn.userId;
    borrowCountMap.set(userId, (borrowCountMap.get(userId) || 0) + 1);
});
 
// Step 2: Find the max borrow count
let maxBorrowCount = 0;
borrowCountMap.forEach(count => {
    if (count > maxBorrowCount) maxBorrowCount = count;
});
 
// Step 3: Sort and generate the table rows
transactions
    .sort((a, b) => b.borrowDate - a.borrowDate)
    .forEach(txn => {
        const borrow = new Date(txn.borrowDate);
        const returnDate = txn.returnDate ? new Date(txn.returnDate) : new Date();
        const borrowMid = new Date(borrow.getFullYear(), borrow.getMonth(), borrow.getDate());
        const returnMid = new Date(returnDate.getFullYear(), returnDate.getMonth(), returnDate.getDate());
        const diffDays = Math.floor((returnMid - borrowMid) / (1000 * 60 * 60 * 24)) + 1;
        const userId = txn.userId;
        const borrowCount = borrowCountMap.get(userId) || 0;
        const isTopUser = borrowCount === maxBorrowCount ? '⭐' : '';
 
        tableHTML += `
            <tr>
            <td>${userMap.get(userId) || 'Unknown User'} ${isTopUser}</td>
            <td>${borrowCount}</td>
            <td>${borrow.toLocaleString()}</td>
            <td>${txn.returnDate ? returnDate.toLocaleString() : 'Not Returned'}</td>
            <td class="${diffDays > 5 ? 'danger' : ''}">${diffDays}</td>
            
            </tr>`;
           });

          tableHTML += '</tbody></table>';
           historyModalBody.innerHTML = tableHTML;

        }
        historyModal.classList.add('active');
    }

    prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderBooks(); } });
    nextPageBtn.addEventListener('click', () => { currentPage++; renderBooks(); });
    
    function showConfirmation(message, callback) {
        document.getElementById('confirmation-message').textContent = message;
        confirmationDialog.classList.add('active');
        confirmActionCallback = callback;
    }
    
    function hideConfirmation() { 
        confirmationDialog.classList.remove('active');
        confirmActionCallback = null;
    }
    document.getElementById('confirm-yes').addEventListener('click', () => { if (confirmActionCallback) { confirmActionCallback(); } hideConfirmation(); });
    document.getElementById('confirm-no').addEventListener('click', hideConfirmation);
    
    // NEW: Close handler for the history modal
    historyModalCloseBtn.addEventListener('click', () => historyModal.classList.remove('active'));
    
    // --- Initialize ---
    try {
        db = await initDB();
        showPage('login');
    } catch (error) { 
        console.error("Initialization failed:", error);
        document.body.innerHTML = `<h1>Error: Could not start the application. Please ensure your browser supports IndexedDB and is not in private mode.</h1><p>${error}</p>`; 
    }
});