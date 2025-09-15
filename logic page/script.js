document.addEventListener('DOMContentLoaded', async () => {
    // --- IndexedDB Setup ---
    const DB_NAME = 'LibraryDB';
    const DB_VERSION = 1;

    let db;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                db = event.target.result;
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'userId', autoIncrement: true });
                    userStore.createIndex('username', 'username', { unique: true });
                    userStore.add({ username: 'admin', password: 'admin', role: 'admin' });
                    userStore.add({ username: 'student', password: 'student', role: 'student' });
                }
                if (!db.objectStoreNames.contains('books')) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'bookId', autoIncrement: true });
                    bookStore.add({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', category: 'Fiction', available: true, borrowerId: null });
                    bookStore.add({ title: 'Cosmos', author: 'Carl Sagan', category: 'Science', available: true, borrowerId: null });
                    bookStore.add({ title: 'Sapiens', author: 'Yuval Noah Harari', category: 'History', available: false, borrowerId: 2 });
                    // Add more books to test pagination
                    for(let i = 1; i <= 10; i++) {
                        bookStore.add({ title: `Fiction Book ${i}`, author: `Author ${i}`, category: 'Fiction', available: true, borrowerId: null });
                    }
                }
            };
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = () => reject(new Error('IndexedDB error'));
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

    // --- Global State ---
    let currentUser = null;
    let allBooks = [];
    let confirmActionCallback = null;
    let currentPage = 1;
    const BOOKS_PER_PAGE = 5;

    // --- Utility & DB Functions ---
    const operateOnDB = (storeName, mode, callback) => new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = callback(store);
        transaction.oncomplete = () => resolve(request ? request.result : undefined);
        transaction.onerror = () => reject(transaction.error);
    });

    const getAll = (store) => operateOnDB(store, 'readonly', s => s.getAll());
    const get = (store, key) => operateOnDB(store, 'readonly', s => s.get(key));
    const add = (store, data) => operateOnDB(store, 'readwrite', s => s.add(data));
    const put = (store, data) => operateOnDB(store, 'readwrite', s => s.put(data));
    const del = (store, key) => operateOnDB(store, 'readwrite', s => s.delete(key));
    const showPage = (pageName) => Object.values(pages).forEach(p => p.classList.toggle('active', p === pages[pageName]));
    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.style.backgroundColor = type === 'success' ? 'var(--success-color)' : 'var(--danger-color)';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // --- Core Functions ---
    function renderBooks() {
        const searchTerm = searchInput.value.toLowerCase();
        const category = categoryFilter.value;
        const filteredBooks = allBooks.filter(book =>
            (book.title.toLowerCase().includes(searchTerm) || (book.author && book.author.toLowerCase().includes(searchTerm))) &&
            (category === '' || book.category === category)
        );

        // Pagination Logic
        const totalPages = Math.ceil(filteredBooks.length / BOOKS_PER_PAGE);
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
        
        // Update pagination UI
        pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
    }
    
    function generateActionButtons(book) {
        if (currentUser.role === 'admin') return `<button class="btn btn-danger delete-book-btn" data-book-id="${book.bookId}"><i class="fas fa-trash"></i></button>`;
        if (currentUser.role === 'student') {
            if (book.available) return `<button class="btn btn-primary borrow-btn" data-book-id="${book.bookId}">Borrow</button>`;
            if (book.borrowerId === currentUser.userId) return `<button class="btn btn-secondary return-btn" data-book-id="${book.bookId}">Return</button>`;
        }
        return '—';
    }

    async function loadBooks() {
        allBooks = await getAll('books');
        currentPage = 1;
        renderBooks();
    }
    
    // --- Event Handlers ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const users = await getAll('users');
        const user = users.find(u => u.username === e.target.username.value && u.password === e.target.password.value);
        if (user) {
            currentUser = user;
            welcomeMessage.textContent = `Welcome, ${currentUser.username}!`;
            addBookBtn.style.display = currentUser.role === 'admin' ? 'inline-flex' : 'none';
            body.classList.add('dashboard-view');
            body.classList.remove('login-view');
            await loadBooks();
            showPage('dashboard');
            showToast('Login successful!');
        } else {
            document.getElementById('login-error').textContent = 'Invalid username or password.';
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
    addBookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await add('books', { title: e.target['new-book-title'].value, author: e.target['new-book-author'].value, category: e.target['new-book-category'].value, available: true, borrowerId: null });
        showToast('Book added successfully!');
        addBookForm.reset();
        await loadBooks();
        showPage('dashboard');
    });

    bookTableBody.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        if (!button) return;
        const bookId = parseInt(button.dataset.bookId);
        const actions = {
            'delete-book-btn': () => showConfirmation('Delete this book?', async () => { await del('books', bookId); showToast('Book deleted.', 'danger'); loadBooks(); }),
            'borrow-btn': () => showConfirmation('Borrow this book?', async () => { const book = await get('books', bookId); book.available = false; book.borrowerId = currentUser.userId; await put('books', book); showToast('Book borrowed!'); loadBooks(); }),
            'return-btn': () => showConfirmation('Return this book?', async () => { const book = await get('books', bookId); book.available = true; book.borrowerId = null; await put('books', book); showToast('Book returned!'); loadBooks(); })
        };
        for (const cls in actions) { if (button.classList.contains(cls)) actions[cls](); }
    });

    prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderBooks(); } });
    nextPageBtn.addEventListener('click', () => { currentPage++; renderBooks(); });
    
    function showConfirmation(message, callback) {
        document.getElementById('confirmation-message').textContent = message;
        confirmationDialog.classList.add('active');
        confirmActionCallback = callback;
    }
    document.getElementById('confirm-yes').addEventListener('click', () => { if (confirmActionCallback) confirmActionCallback(); hideConfirmation(); });
    document.getElementById('confirm-no').addEventListener('click', hideConfirmation);
    function hideConfirmation() { confirmationDialog.classList.remove('active'); }
    
    // --- Initialize ---
    try {
        db = await initDB();
        showPage('login');
    } catch (error) { document.body.innerHTML = '<h1>Error: Could not start the application.</h1>'; }
});