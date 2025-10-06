document.addEventListener('DOMContentLoaded', async () => {
    // --- IndexedDB Setup ---
    const DB_NAME = 'LibraryDB';
    const DB_VERSION = 3; // Use the latest version for full features
    const DUE_DAYS = 7;
    let db;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;

                // Users Table with Roles
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'userId', autoIncrement: true });
                    userStore.createIndex('username', 'username', { unique: true });
                    // Use transaction.oncomplete to ensure store is created before adding data
                    transaction.oncomplete = () => {
                         const usersTx = db.transaction('users', 'readwrite');
                         const usersStore = usersTx.objectStore('users');
                         usersStore.add({ username: 'superadmin', password: 'superadmin', role: 'super-admin' });
                         usersStore.add({ username: 'librarian', password: 'librarian', role: 'librarian' });
                         usersStore.add({ username: 'student', password: '123', role: 'student' });
                         usersStore.add({ username: 'thulasi', password: '123', role: 'student' });
                         usersStore.add({ username: 'hari', password: '123', role: 'student' });
                    };
                }

                // Books Table
                if (!db.objectStoreNames.contains('books')) {
                    const bookStore = db.createObjectStore('books', { keyPath: 'bookId', autoIncrement: true });
                    bookStore.createIndex('category', 'category', { unique: false });
                    bookStore.add({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', category: 'Fiction', available: true, borrowerId: null });
                    bookStore.add({ title: 'Cosmos', author: 'Carl Sagan', category: 'Science', available: true, borrowerId: null });
                    bookStore.add({ title: 'Sapiens', author: 'Yuval Noah Harari', category: 'History', available: false, borrowerId: 3 }); // Borrowed by student
                     for(let i = 1; i <= 10; i++) {
                        bookStore.add({ title: `Fiction Book ${i}`, author: `Author ${i}`, category: 'Fiction', available: true, borrowerId: null });
                    }
                }

                // Transactions Table
                if (!db.objectStoreNames.contains('transactions')) {
                    const txnStore = db.createObjectStore('transactions', { keyPath: 'txnId', autoIncrement: true });
                    txnStore.createIndex('bookId', 'bookId', { unique: false });
                    txnStore.createIndex('userId', 'userId', { unique: false });
                    // Overdue book transaction
                    txnStore.add({ bookId: 3, userId: 3, borrowDate: new Date(Date.now() - (DUE_DAYS + 3) * 24 * 60 * 60 * 1000), returnDate: null });
                }
            };
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
        });
    }

    // --- UI Elements ---
    const body = document.body;
    const pages = {
        login: document.getElementById('login-page'),
         dashboard: document.getElementById('dashboard-page'),
        addBook: document.getElementById('add-book-page'),
         overdue: document.getElementById('overdue-page'),
        transactions: document.getElementById('transactions-page'),
         students: document.getElementById('students-page'),
        profile: document.getElementById('profile-page'), 
        adminManagement: document.getElementById('admin-management-page'),
    };
    // Forms & Buttons
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    const addBookBtn = document.getElementById('add-book-btn');
    const addBookForm = document.getElementById('add-book-form');
    const cancelAddBookBtn = document.getElementById('cancel-add-book-btn');
    const addLibrarianForm = document.getElementById('add-librarian-form');
    const updateProfileForm = document.getElementById('update-profile-form');
    // Display areas
    const welcomeMessage = document.getElementById('welcome-message');
    const adminNav = document.getElementById('admin-nav');
    const bookTableBody = document.getElementById('book-table-body');
    // Modals & Toasts
    const toast = document.getElementById('toast');
    const confirmationDialog = document.getElementById('confirmation-dialog');
    const historyModal = document.getElementById('history-modal');
    // Filters & Search
    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');
    const availabilityFilter = document.getElementById('availability-filter');
    // Pagination
    const paginationControls = document.getElementById('pagination-controls');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');


    // --- Global State ---
    let currentUser = null, allBooks = [], allUsers = [], allTransactions = [], currentProfileUserId = null;
    let confirmActionCallback = null, currentPage = 1;
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
    const getAll = store => operateOnDB(store, 'readonly', s => s.getAll());
    const get = (store, key) => operateOnDB(store, 'readonly', s => s.get(key));
    const add = (store, data) => operateOnDB(store, 'readwrite', s => s.add(data));
    const put = (store, data) => operateOnDB(store, 'readwrite', s => s.put(data));
    const del = (store, key) => operateOnDB(store, 'readwrite', s => s.delete(key));

    const showPage = (pageName) => {
        Object.values(pages).forEach(p => p.classList.toggle('active', p === pages[pageName]));
        document.querySelectorAll('#admin-nav a').forEach(link => link.classList.toggle('active', link.dataset.page === pageName));
    };

    function showToast(message, type = 'success') {
        toast.textContent = message; toast.className = 'show';
        toast.style.backgroundColor = type === 'success' ? 'var(--success-color)' : 'var(--danger-color)';
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function showConfirmation(message, callback) {
        document.getElementById('confirmation-message').textContent = message;
        confirmationDialog.classList.add('active');
        confirmActionCallback = callback;
    }

    function hideConfirmation() {
        confirmationDialog.classList.remove('active');
        confirmActionCallback = null;
    }

    async function loadAllData() {
        [allBooks, allUsers, allTransactions] = await Promise.all([getAll('books'), getAll('users'), getAll('transactions')]);
    }

    function setupUIForRole() {
        const isAdmin = currentUser.role === 'super-admin' || currentUser.role === 'librarian';
        const isSuperAdmin = currentUser.role === 'super-admin';

        adminNav.style.display = isAdmin ? 'flex' : 'none';
        document.getElementById('dashboard-analytics').style.display = isAdmin ? 'grid' : 'none';
        addBookBtn.style.display = isAdmin ? 'inline-flex' : 'none';
        document.getElementById('admin-management-link').style.display = isSuperAdmin ? 'block' : 'none';

        renderBooks(); // Re-render books to show correct action buttons
    }

    // --- Rendering Functions ---
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
        const availability = availabilityFilter.value;

        const filteredBooks = allBooks.filter(book =>
            (book.title.toLowerCase().includes(searchTerm) || book.author.toLowerCase().includes(searchTerm)) &&
            (category === '' || book.category === category) &&
            (availability === '' || (availability === 'available' ? book.available : !book.available))
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
                <td><span class="status-badge ${book.available ? 'status-available' : 'status-borrowed'}"><i class="fas fa-${book.available ? 'check' : 'times'}-circle"></i> ${book.available ? 'Available' : 'Borrowed'}</span></td>
                <td class="table-actions">${generateActionButtons(book)}</td>`;
        });

        pageInfo.textContent = `Page ${currentPage} of ${totalPages || 1}`;
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    function generateActionButtons(book) {
        const isAdmin = currentUser.role === 'super-admin' || currentUser.role === 'librarian';
        if (isAdmin) {
            let buttons = `<button class="btn btn-secondary view-history-btn" data-book-id="${book.bookId}" title="View History"><i class="fas fa-history"></i></button>`;
            if (currentUser.role === 'super-admin') {
                 buttons += ` <button class="btn btn-danger delete-book-btn" data-book-id="${book.bookId}" title="Delete Book"><i class="fas fa-trash"></i></button>`;
            }
            return buttons;
        }
        if (currentUser.role === 'student') {
            if (book.available) return `<button class="btn btn-primary borrow-btn" data-book-id="${book.bookId}">Borrow</button>`;
            if (book.borrowerId === currentUser.userId) return `<button class="btn btn-secondary return-btn" data-book-id="${book.bookId}">Return</button>`;
        }
        return '—';
    }
    
    // --- All Report & Page Rendering Functions ---
    
    function renderDashboardAnalytics() {
        const borrowedBooks = allBooks.filter(b => !b.available).length;
        const overdueTxns = allTransactions.filter(t => {
            if (t.returnDate) return false;
            const diffDays = (new Date() - new Date(t.borrowDate)) / (1000 * 60 * 60 * 24);
            return diffDays > DUE_DAYS;
        });
        document.getElementById('total-books-stat').textContent = allBooks.length;
        document.getElementById('available-books-stat').textContent = allBooks.length - borrowedBooks;
        document.getElementById('borrowed-books-stat').textContent = borrowedBooks;
        document.getElementById('overdue-books-stat').textContent = overdueTxns.length;
    }

    function renderOverdueReport() {
        const userMap = new Map(allUsers.map(u => [u.userId, u.username]));
        const bookMap = new Map(allBooks.map(b => [b.bookId, b.title]));
        const overdueTxns = allTransactions.filter(t => {
            if (t.returnDate) return false;
            const diffDays = (new Date() - new Date(t.borrowDate)) / (1000 * 60 * 60 * 24);
            return diffDays > DUE_DAYS;
        });

        const tableBody = document.getElementById('overdue-table-body');
        tableBody.innerHTML = '';
        document.getElementById('no-overdue-message').style.display = overdueTxns.length ? 'none' : 'block';

        overdueTxns.forEach(t => {
            const diff = Math.floor((new Date() - new Date(t.borrowDate)) / (1000 * 60 * 60 * 24));
            const daysOverdue = diff - DUE_DAYS;
            tableBody.insertRow().innerHTML = `
                <td>${bookMap.get(t.bookId) || 'Unknown Book'}</td>
                <td>${userMap.get(t.userId) || 'Unknown User'}</td>
                <td>${new Date(t.borrowDate).toLocaleDateString()}</td>
                <td class="overdue-days">${daysOverdue}</td>`;
        });
    }

    function renderTransactionsReport() {
        const userMap = new Map(allUsers.map(u => [u.userId, u.username]));
        const bookMap = new Map(allBooks.map(b => [b.bookId, b.title]));
        const tableBody = document.getElementById('transactions-table-body');
        tableBody.innerHTML = '';
        document.getElementById('no-transactions-message').style.display = allTransactions.length ? 'none' : 'block';
        
        [...allTransactions].sort((a,b) => new Date(b.borrowDate) - new Date(a.borrowDate)).forEach(t => {
            tableBody.insertRow().innerHTML = `
                <td>${bookMap.get(t.bookId) || 'Unknown Book'}</td>
                <td>${userMap.get(t.userId) || 'Unknown User'}</td>
                <td>${new Date(t.borrowDate).toLocaleString()}</td>
                <td>${t.returnDate ? new Date(t.returnDate).toLocaleString() : '—'}</td>`;
        });
    }

    function renderStudentsPage() {
        const students = allUsers.filter(u => u.role === 'student');
        const tableBody = document.getElementById('students-table-body');
        tableBody.innerHTML = '';
        document.getElementById('no-students-message').style.display = students.length ? 'none' : 'block';
        students.forEach(student => {
            tableBody.insertRow().innerHTML = `<td>${student.userId}</td><td>${student.username}</td>
                <td class="table-actions"><button class="btn btn-primary view-profile-btn" data-user-id="${student.userId}"><i class="fas fa-eye"></i> View Profile</button></td>`;
        });
    }

    async function renderProfilePage(userId) {
        currentProfileUserId = userId;
        const user = allUsers.find(u => u.userId === userId);
        document.getElementById('profile-page-title').innerHTML = `<i class="fas fa-user-circle"></i> ${user.username}'s Profile`;

        const userTxns = allTransactions.filter(t => t.userId === userId);
        const bookMap = new Map(allBooks.map(b => [b.bookId, b]));

        // Render borrowed books
        const borrowedBody = document.getElementById('profile-borrowed-table').querySelector('tbody');
        borrowedBody.innerHTML = '';
        const borrowedTxns = userTxns.filter(t => !t.returnDate);
        document.getElementById('no-borrowed-message').style.display = borrowedTxns.length ? 'none' : 'block';
        borrowedTxns.forEach(t => {
            const book = bookMap.get(t.bookId);
            borrowedBody.insertRow().innerHTML = `<td>${book.title}</td><td>${book.author}</td><td>${new Date(t.borrowDate).toLocaleDateString()}</td>`;
        });

        // Render history
        const historyBody = document.getElementById('profile-history-table').querySelector('tbody');
        historyBody.innerHTML = '';
        const historyTxns = userTxns.filter(t => t.returnDate).sort((a,b) => new Date(b.returnDate) - new Date(a.returnDate));
        document.getElementById('no-history-message').style.display = historyTxns.length ? 'none' : 'block';
        historyTxns.forEach(t => {
            const book = bookMap.get(t.bookId);
            historyBody.insertRow().innerHTML = `<td>${book.title}</td><td>${book.author}</td><td>${new Date(t.borrowDate).toLocaleDateString()}</td><td>${new Date(t.returnDate).toLocaleDateString()}</td>`;
        });

        updateProfileForm.reset();
        showPage('profile');
    }

    function renderAdminManagementPage() {
        const admins = allUsers.filter(u => u.role.includes('admin') || u.role.includes('librarian'));                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              
        const tableBody = document.getElementById('admins-table-body');
        tableBody.innerHTML = '';
        admins.forEach(admin => {
            tableBody.insertRow().innerHTML = `<td>${admin.userId}</td><td>${admin.username}</td><td>${admin.role}</td>
                <td class="table-actions">${admin.role !== 'super-admin' ? `<button class="btn btn-danger delete-user-btn" data-user-id="${admin.userId}"><i class="fas fa-trash"></i> Delete</button>` : '—'}</td>`;
        });
    }
    
    async function showHistoryModal(bookId) {
        const book = await get('books', bookId);
        const transactions = await operateOnDB('transactions', 'readonly', store => store.index('bookId').getAll(bookId));
        const userMap = new Map(allUsers.map(user => [user.userId, user.username]));

        document.getElementById('history-modal-title').textContent = `History for "${book.title}"`;
        const modalBody = document.getElementById('history-modal-body');

        if (transactions.length === 0) {
            modalBody.innerHTML = '<p class="info-message">No borrow history found for this book.</p>';
        } else {
            let tableHTML = `<table><thead><tr><th>User</th><th>Borrow Date</th><th>Return Date</th><th>Duration (Days)</th></tr></thead><tbody>`;
            transactions.sort((a, b) => new Date(b.borrowDate) - new Date(a.borrowDate))
            .forEach(txn => {
                const borrowDate = new Date(txn.borrowDate);
                const returnDate = txn.returnDate ? new Date(txn.returnDate) : new Date(); // Use today if not returned
                const diffDays = Math.ceil((returnDate - borrowDate) / (1000 * 60 * 60 * 24));
                tableHTML += `
                    <tr>
                        <td>${userMap.get(txn.userId) || 'Unknown User'}</td>
                        <td>${borrowDate.toLocaleString()}</td>
                        <td>${txn.returnDate ? returnDate.toLocaleString() : 'Not Returned'}</td>
                        <td class="${diffDays > DUE_DAYS ? 'danger' : ''}">${diffDays}</td>
                    </tr>`;
            });
            tableHTML += '</tbody></table>';
            modalBody.innerHTML = tableHTML;
        }
        historyModal.classList.add('active');
    }

    // --- Event Handlers ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = e.target.username.value;
        const password = e.target.password.value;
        const users = await getAll('users');
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            currentUser = user;
            welcomeMessage.textContent = `Welcome, ${currentUser.username}!`;
            body.classList.replace('login-view', 'dashboard-view');
            
            await loadAllData();
            await populateCategories();
            setupUIForRole();
            
            if (currentUser.role !== 'student') {
                renderDashboardAnalytics();
            }
            showPage('dashboard');
            showToast('Login successful!');
            loginForm.reset();
            document.getElementById('login-error').textContent = '';
        } else {
            document.getElementById('login-error').textContent = 'Invalid username or password.';
        }
    });

    logoutBtn.addEventListener('click', () => {
        currentUser = null;
        loginForm.reset();
        document.getElementById('login-error').textContent = '';
        body.classList.replace('dashboard-view', 'login-view');
        showPage('login');
    });

    adminNav.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.target.tagName !== 'A') return;
        const page = e.target.dataset.page;
        if (page === 'dashboard') renderDashboardAnalytics();
        if (page === 'students') renderStudentsPage();
        if (page === 'adminManagement') renderAdminManagementPage();
        if (page === 'overdue') renderOverdueReport();
        if (page === 'transactions') renderTransactionsReport();
        showPage(page);
    });

    // Book related actions
    const triggerRender = () => { currentPage = 1; renderBooks(); };
    searchInput.addEventListener('input', triggerRender);
    categoryFilter.addEventListener('change', triggerRender);
    availabilityFilter.addEventListener('change', triggerRender);

    addBookBtn.addEventListener('click', () => showPage('addBook'));
    cancelAddBookBtn.addEventListener('click', () => showPage('dashboard'));

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
        await loadAllData();
        await populateCategories();
        renderDashboardAnalytics();
        showPage('dashboard');
    });

    bookTableBody.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const bookId = parseInt(button.dataset.bookId);

        if (button.classList.contains('delete-book-btn')) {
            showConfirmation('Are you sure you want to delete this book? This is irreversible.', async () => {
                await del('books', bookId);
                showToast('Book deleted.', 'danger');
                await loadAllData();
                renderBooks();
                renderDashboardAnalytics();
            });
        } else if (button.classList.contains('borrow-btn')) {
            showConfirmation('Are you sure you want to borrow this book?', async () => {
                const book = await get('books', bookId);
                book.available = false;
                book.borrowerId = currentUser.userId;
                await put('books', book);
                await add('transactions', { bookId, userId: currentUser.userId, borrowDate: new Date(), returnDate: null});
                showToast('Book borrowed successfully!');
                await loadAllData();
                renderBooks();
            });
        } else if (button.classList.contains('return-btn')) {
            showConfirmation('Are you sure you want to return this book?', async () => {
                const book = await get('books', bookId);
                book.available = true;
                book.borrowerId = null;
                await put('books', book);
                await operateOnDB('transactions', 'readwrite', store => {
                    const index = store.index('bookId');
                    index.getAll(bookId).onsuccess = (event) => {
                        const openTxn = event.target.result.find(t => t.returnDate === null && t.userId === currentUser.userId);
                        if (openTxn) {
                            openTxn.returnDate = new Date();
                            store.put(openTxn);
                        }
                    };
                });
                showToast('Book returned successfully!');
                await loadAllData();
                renderBooks();
            });
        } else if (button.classList.contains('view-history-btn')) {
            await showHistoryModal(bookId);
        }
    });

    // Student and Admin page handlers
    document.getElementById('students-table-body').addEventListener('click', e => {
        if (e.target.closest('.view-profile-btn')) renderProfilePage(parseInt(e.target.closest('.view-profile-btn').dataset.userId));
    });

    document.querySelector('.back-to-students-btn').addEventListener('click', () => showPage('students'));
    
    updateProfileForm.addEventListener('submit', async e => {
        e.preventDefault();
        const newPassword = document.getElementById('update-password').value;
        if (newPassword.length < 4) {
            showToast('Password must be at least 4 characters long.', 'danger');
            return;
        }
        const userToUpdate = await get('users', currentProfileUserId);
        userToUpdate.password = newPassword;
        await put('users', userToUpdate);
        await loadAllData(); // reload users
        showToast('Password updated successfully!');
        updateProfileForm.reset();
    });

    addLibrarianForm.addEventListener('submit', async e => {
        e.preventDefault();
        const username = document.getElementById('new-librarian-username').value.trim();
        const password = document.getElementById('new-librarian-password').value.trim();
        
        if (username.length < 3 || password.length < 4) {
            showToast('Username must be 3+ chars, password 4+ chars.', 'danger');
            return;
        }

        if (allUsers.some(u => u.username === username)) {
            showToast('Username already exists.', 'danger');
            return;
        }
        
        await add('users', { username, password, role: 'librarian' });
        showToast('Librarian created successfully!');
        await loadAllData();
        renderAdminManagementPage();
        addLibrarianForm.reset();
    });

    document.getElementById('admins-table-body').addEventListener('click', async e => {
        const deleteBtn = e.target.closest('.delete-user-btn');
        if (deleteBtn) {
            const userId = parseInt(deleteBtn.dataset.userId);
            showConfirmation('Are you sure you want to delete this user?', async () => {
                await del('users', userId);
                showToast('User deleted.', 'danger');
                await loadAllData();
                renderAdminManagementPage();
            });
        }
    });
    
    // Pagination handlers
    prevPageBtn.addEventListener('click', () => { if (currentPage > 1) { currentPage--; renderBooks(); } });
    nextPageBtn.addEventListener('click', () => { currentPage++; renderBooks(); });

    // Modal and Confirmation Handlers
    document.getElementById('confirm-yes').addEventListener('click', () => { if (confirmActionCallback) { confirmActionCallback(); } hideConfirmation(); });
    document.getElementById('confirm-no').addEventListener('click', hideConfirmation);
    document.getElementById('history-modal-close').addEventListener('click', () => historyModal.classList.remove('active'));

    // CSV Export
    document.getElementById('export-csv-btn').addEventListener('click', () => {
         const userMap = new Map(allUsers.map(u => [u.userId, u.username]));
         const bookMap = new Map(allBooks.map(b => [b.bookId, b.title]));
         let csvContent = "data:text/csv;charset=utf-8,Book Title,User,Borrow Date,Return Date\n";
         
         allTransactions.forEach(t => {
            const row = [
                `"${bookMap.get(t.bookId) || 'N/A'}"`,
                `"${userMap.get(t.userId) || 'N/A'}"`,
                `"${new Date(t.borrowDate).toLocaleString()}"`,
                `"${t.returnDate ? new Date(t.returnDate).toLocaleString() : ''}"`
            ].join(',');
            csvContent += row + "\n";
         });

         const encodedUri = encodeURI(csvContent);
         const link = document.createElement("a");
         link.setAttribute("href", encodedUri);
         link.setAttribute("download", "library_transactions.csv");
         document.body.appendChild(link);
         link.click();
         document.body.removeChild(link);
    });

    // --- Initialize ---
    try {
        db = await initDB();
        showPage('login');
    } catch (error) {
        console.error("Initialization failed:", error);
        body.innerHTML = `<h1>Error: Could not start the application. Please ensure your browser supports IndexedDB and is not in private mode.</h1><p>${error}</p>`;
    }
});
