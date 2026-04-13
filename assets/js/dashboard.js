let accountIdToUnlink = null;

document.addEventListener('DOMContentLoaded', () => {
    
    // Tab Switching Logic
    const navBtns = document.querySelectorAll('.nav-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const mobileNavItems = document.querySelectorAll('.bottom-nav .nav-item');

    // Function to switch tabs
    window.switchTab = (tabId) => {
        // Remove active class from all contents
        tabContents.forEach(content => content.classList.remove('active'));
        
        // Add active class to target content
        const targetContent = document.getElementById(tabId);
        if (targetContent) {
            targetContent.classList.add('active');
        }

        // Update Sidebar Buttons
        navBtns.forEach(btn => {
            btn.classList.remove('active');
            if(btn.dataset.tab === tabId) btn.classList.add('active');
        });

        // Update Mobile Nav (if applicable)
        mobileNavItems.forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('onclick')?.includes(tabId)) item.classList.add('active');
        });

        // Update Header Title
        const headerTitle = document.getElementById('header-title');
        if (headerTitle) {
            const titles = {
                'overview': 'Dashboard',
                'history': 'Transaction History',
                'transfers': 'Transfers & Payments',
                'accounts': 'External Accounts',
                'settings': 'Account Settings'
            };
            headerTitle.textContent = titles[tabId] || 'Dashboard';
        }

        if (tabId === 'history') {
            fetchTransactionHistory();
        }
    };

    // Add event listeners to sidebar buttons
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Custom Dropdown Handler
    window.setupCustomDropdowns = () => {
        const dropdownButtons = document.querySelectorAll('.select-button');
        
        dropdownButtons.forEach((button) => {
            // Remove all existing listeners by cloning to reset
            const newButton = button.cloneNode(true);
            button.parentNode.replaceChild(newButton, button);
            
            // Add fresh click listener
            newButton.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                const dropdown = this.nextElementSibling;
                if (!dropdown) return;
                
                const isActive = dropdown.classList.contains('active');
                
                // Close all other dropdowns
                document.querySelectorAll('.select-dropdown.active').forEach(dd => {
                    dd.classList.remove('active');
                    dd.previousElementSibling?.classList.remove('active');
                });
                
                // Open this dropdown if it was closed
                if (!isActive) {
                    dropdown.classList.add('active');
                    this.classList.add('active');
                }
            }, { passive: false });
        });
    };

    // Setup custom dropdowns
    setTimeout(() => window.setupCustomDropdowns(), 100);

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select')) {
            document.querySelectorAll('.select-dropdown.active').forEach(dropdown => {
                dropdown.classList.remove('active');
                if (dropdown.previousElementSibling) {
                    dropdown.previousElementSibling.classList.remove('active');
                }
            });
        }
    });

    // Notification Dropdown Logic
    const notifBtn = document.getElementById('notifBtn');
    const notifDropdown = document.getElementById('notifDropdown');

    if (notifBtn) {
        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
                notifDropdown.classList.remove('show');
            }
        });
    }

    // Profile Dropdown Logic
    const profileBtn = document.getElementById('profileBtn');
    const profileDropdown = document.getElementById('profileDropdown');

    if (profileBtn) {
        profileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('show');
            if (notifDropdown) notifDropdown.classList.remove('show'); // Close notifications if open
        });

        document.addEventListener('click', (e) => {
            if (!profileBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.remove('show');
            }
        });
    }

    // Initial Data Load
    if (window.__INITIAL_DATA__) {
        // Data was injected by the server, use it immediately
        updateDashboardUI(window.__INITIAL_DATA__);
        // Clean up to prevent using stale data on subsequent navigations (if this were a SPA)
        delete window.__INITIAL_DATA__; 
    } else {
        // Fallback for direct access or errors: fetch data as before
        fetchDashboardData();
    }

    // Poll for new notifications/data every 10 seconds
    setInterval(fetchDashboardData, 10000);

    // --- FORM HANDLERS ---

    // 1. Internal Transfer
    const transferForm = document.getElementById('transfer-form');
    if (transferForm) {
        transferForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fromAccountId = document.getElementById('transfer-from-value')?.value;
            const toAccountId = document.getElementById('transfer-to-value')?.value;
            const amount = document.getElementById('transfer-amount').value;

            if (!fromAccountId) return showToast('Please select a "From" account.', 'error');
            if (!toAccountId) return showToast('Please select a "To" account.', 'error');
            if (fromAccountId === toAccountId) return showToast('Cannot transfer to the same account.', 'error');

            await postData('/api/transfer', { fromAccountId, toAccountId, amount });
            fetchDashboardData(); // Refresh data
            
            // Reset form and dropdowns
            transferForm.reset();
            document.getElementById('transfer-from-value').value = '';
            document.getElementById('transfer-to-value').value = '';
            document.getElementById('transfer-from-button').querySelector('.select-button-text').textContent = 'Select Account';
            document.getElementById('transfer-to-button').querySelector('.select-button-text').textContent = 'Select Account';
        });
    }

    // 2. Zelle
    const zelleForm = document.getElementById('zelle-form');
    if (zelleForm) {
        zelleForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const recipient = document.getElementById('zelle-recipient').value;
            const amount = document.getElementById('zelle-amount').value;

            // Custom handling for receipt
            try {
                const res = await fetch('/api/zelle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recipient, amount })
                });
                const result = await res.json();
                if (result.success) {
                    fetchDashboardData(); // Refresh balance in the background
                    showInPlaceZelleReceipt(recipient, amount);
                } else {
                    showToast(result.error || 'Payment failed', 'error');
                }
            } catch (err) {
                showToast('An error occurred during payment.', 'error');
            }
        });
    }

    // 3. Link External Account
    const linkForm = document.getElementById('link-account-form');
    if (linkForm) {
        linkForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const bankName = document.getElementById('link-bank-name').value;
            const routingNumber = document.getElementById('link-routing').value;
            const accountNumber = document.getElementById('link-account').value;

            await postData('/api/external-accounts', { bankName, routingNumber, accountNumber });
            fetchDashboardData();
            linkForm.reset();
        });
    }

    // 4. Update Profile
    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('settings-email').value;
            const phone = document.getElementById('settings-phone').value;

            await postData('/api/settings/profile', { email, phone });
            fetchDashboardData(); // Refresh to show notification
        });
    }

    // 5. Update Password
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            if (newPassword !== confirmPassword) return showToast('New passwords do not match', 'error');

            await postData('/api/settings/password', { currentPassword, newPassword });
            passwordForm.reset();
        });
    }

    // 5. Add Recipient
    const addRecipientForm = document.getElementById('add-recipient-form');
    if (addRecipientForm) {
        addRecipientForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-recipient-name').value;
            const email = document.getElementById('new-recipient-email').value;

            await postData('/api/recipients', { name, email });
            document.getElementById('add-recipient-modal').classList.remove('active');
            addRecipientForm.reset();
            fetchDashboardData(); // Refresh list
        });
    }

    // 6. Unlink Confirmation Logic
    const confirmUnlinkBtn = document.getElementById('confirm-unlink-btn');
    if (confirmUnlinkBtn) {
        confirmUnlinkBtn.addEventListener('click', async () => {
            if (!accountIdToUnlink) return;
            
            const id = accountIdToUnlink;
            window.closeUnlinkModal(); // Close modal immediately
            
            try {
                const res = await fetch(`/api/external-accounts/${id}`, { method: 'DELETE' });
                const result = await res.json();
                if (result.success) {
                    fetchDashboardData();
                    showToast('Account unlinked successfully.', 'success');
                } else {
                    showToast('Failed to unlink account.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('An error occurred while unlinking.', 'error');
            }
        });
    }
});

// Helper to POST data
async function postData(url, data) {
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showToast(result.message || 'Success!', 'success');
        } else {
            showToast(result.error || 'Action failed', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('An error occurred', 'error');
    }
}

// Toast Notification Function
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3500);
}

// This is the primary declaration of this function.
async function fetchDashboardData() {
    try {
        const response = await fetch('/api/dashboard-data');
        if (!response.ok) {
            if (response.status === 401) window.location.href = '/';
            return;
        }
        
        const data = await response.json();
        updateDashboardUI(data);
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
    }
}

function updateDashboardUI(data) {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    // Store notifications globally for notification management
    if (data.notifications) {
        window.currentNotifications = data.notifications;
    }

    // Update User Info
    if (data.user) {
        const greeting = document.getElementById('user-greeting');
        if (greeting) greeting.textContent = `Welcome back, ${data.user.full_name}`;
        
        const settingsName = document.getElementById('settings-name');
        if(settingsName) settingsName.value = data.user.full_name;

        const settingsEmail = document.getElementById('settings-email');
        if(settingsEmail && data.user.email) settingsEmail.value = data.user.email;

        const settingsPhone = document.getElementById('settings-phone');
        if(settingsPhone && data.user.phone) settingsPhone.value = data.user.phone;
    }

    // Update Net Worth
    const netWorthEl = document.getElementById('net-worth-amount');
    if (netWorthEl) netWorthEl.textContent = formatter.format(data.netWorth);

    // Update Main Balance Card (Show Total Balance)
    const mainBalEl = document.getElementById('main-balance-amount');
    const mainNameEl = document.getElementById('main-balance-account-name');
    
    if (mainBalEl) mainBalEl.textContent = formatter.format(data.netWorth);
    if (mainNameEl) mainNameEl.textContent = 'Total Balance';

    // Update Accounts List
    const accListContainer = document.getElementById('accounts-list-container');
    if (accListContainer) {
        accListContainer.innerHTML = '<h3 class="section-header">Your Accounts</h3>'; // Reset
        
        data.accounts.forEach(acc => {
            const iconClass = acc.type.toLowerCase().includes('savings') ? 'fa-piggy-bank' : 'fa-wallet';
            const html = `
                <div class="account-row">
                    <div class="acc-icon"><i class="fas ${iconClass}"></i></div>
                    <div class="acc-details">
                        <h4>${acc.account_name}</h4>
                        <span>**** ${acc.account_number.slice(-4)} • International Credit Union</span>
                    </div>
                    <div class="acc-amount">${formatter.format(acc.balance)}</div>
                </div>
            `;
            accListContainer.insertAdjacentHTML('beforeend', html);
        });
    }

    // Update Transfer Dropdowns
    const fromSelect = document.getElementById('transfer-from-dropdown');
    const toSelect = document.getElementById('transfer-to-dropdown');
    
    if (fromSelect && toSelect) {
        fromSelect.innerHTML = '';
        toSelect.innerHTML = '';
        
        if (!data.accounts || data.accounts.length === 0) {
            const noAccountsMsg = document.createElement('div');
            noAccountsMsg.className = 'select-option';
            noAccountsMsg.textContent = 'No accounts available';
            noAccountsMsg.style.cursor = 'default';
            noAccountsMsg.style.pointerEvents = 'none';
            noAccountsMsg.style.opacity = '0.5';
            fromSelect.appendChild(noAccountsMsg.cloneNode(true));
            toSelect.appendChild(noAccountsMsg.cloneNode(true));
        } else {
            data.accounts.forEach(acc => {
                const optionText = `${acc.account_name} (...${acc.account_number.slice(-4)}) - ${formatter.format(acc.balance)}`;
                
                // From Account Dropdown
                const fromOption = document.createElement('div');
                fromOption.className = 'select-option';
                fromOption.textContent = optionText;
                fromOption.value = acc.id;
                fromOption.onclick = () => selectDropdownOption('transfer-from', acc.id, optionText);
                fromSelect.appendChild(fromOption);
                
                // To Account Dropdown
                const toOption = document.createElement('div');
                toOption.className = 'select-option';
                toOption.textContent = optionText;
                toOption.value = acc.id;
                toOption.onclick = () => selectDropdownOption('transfer-to', acc.id, optionText);
                toSelect.appendChild(toOption);
            });
        }

        // Re-setup event listeners with a slight delay to ensure DOM is updated
        setTimeout(() => {
            window.setupCustomDropdowns();
        }, 50);
    }

    // Update Transactions
    const transList = document.getElementById('transaction-list');
    if (transList) {
        transList.innerHTML = ''; 

        if (data.transactions.length === 0) {
            transList.innerHTML = '<p style="padding:15px; color:#777;">No recent transactions.</p>';
        } else {
            data.transactions.forEach(tx => {
                const isCredit = tx.type === 'Credit';
                const iconClass = isCredit ? 'fa-arrow-down' : 'fa-shopping-cart';
                const colorClass = isCredit ? 'income' : 'expense';
                const amountClass = isCredit ? 'positive' : 'negative';
                const sign = isCredit ? '+' : '-';
                
                const html = `
                    <div class="transaction-item">
                        <div class="trans-icon ${colorClass}"><i class="fas ${iconClass}"></i></div>
                        <div class="trans-details">
                            <h4>${tx.description}</h4>
                            <span>${new Date(tx.date).toLocaleDateString()}</span>
                        </div>
                        <div class="trans-amount ${amountClass}">${sign}${formatter.format(tx.amount)}</div>
                    </div>
                `;
                transList.insertAdjacentHTML('beforeend', html);
            });
        }
    }

    // Update External Accounts List
    const extList = document.getElementById('linked-accounts-list');
    if (extList) {
        extList.innerHTML = '<h3 class="section-header" style="font-size: 1rem;">Linked Institutions</h3>';
        
        if (data.externalAccounts && data.externalAccounts.length > 0) {
            data.externalAccounts.forEach(acc => {
                const html = `
                    <div class="linked-item">
                        <div class="bank-icon"><i class="fas fa-university"></i></div>
                        <div class="bank-info">
                            <h4>${acc.bank_name}</h4>
                            <span>**** ${acc.account_number.slice(-4)}</span>
                        </div>
                        <button class="unlink-btn" onclick="unlinkAccount(${acc.id})">Unlink</button>
                    </div>
                `;
                extList.insertAdjacentHTML('beforeend', html);
            });
        } else {
            extList.insertAdjacentHTML('beforeend', '<p style="color:#777; font-size:0.9rem;">No linked accounts yet.</p>');
        }
    }

    // Update Notifications
    const notifList = document.querySelector('.notif-list');
    const badge = document.querySelector('.badge');
    
    if (notifList && data.notifications) {
        notifList.innerHTML = ''; // Clear existing
        
        // Update Badge Count (count unread)
        const unreadCount = data.notifications.filter(n => !n.is_read).length;
        if (badge) {
            badge.textContent = unreadCount;
            badge.style.display = unreadCount > 0 ? 'block' : 'none';
        }

        if (data.notifications.length === 0) {
            notifList.innerHTML = '<li style="padding:15px; text-align:center;">No notifications</li>';
        } else {
            data.notifications.forEach((notif, index) => {
                const li = document.createElement('li');
                if (!notif.is_read) li.classList.add('unread');
                li.textContent = notif.message;
                li.style.cursor = 'pointer';
                li.setAttribute('data-notif-id', notif.id || index);
                li.setAttribute('data-notif-index', index);
                li.onclick = (e) => {
                    e.stopPropagation();
                    window.markNotificationAsRead(notif.id, index, li);
                };
                notifList.appendChild(li);
            });
        }
    }

    // Update Quick Send Recipients
    const quickSendList = document.getElementById('quick-send-list');
    if (quickSendList) {
        quickSendList.innerHTML = '';
        
        const addNewBtn = document.createElement('div');
        addNewBtn.className = 'avatar-circle add-new';
        addNewBtn.innerHTML = '<i class="fas fa-plus"></i>';
        addNewBtn.onclick = () => document.getElementById('add-recipient-modal').classList.add('active');
        quickSendList.appendChild(addNewBtn);

        if (data.recipients && data.recipients.length > 0) {
            data.recipients.forEach(recipient => {
                const initials = recipient.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                const div = document.createElement('div');
                div.className = 'avatar-circle';
                div.textContent = initials;
                div.title = recipient.name;
                div.onclick = () => {
                    const zelleRecipientInput = document.getElementById('zelle-recipient');
                    if (zelleRecipientInput) {
                        zelleRecipientInput.value = recipient.email || recipient.name;
                    }
                };
                quickSendList.appendChild(div);
            });
        }

    // Update Savings Goals
    const goalsContainer = document.getElementById('savings-goals-container');
    if (goalsContainer) {
        goalsContainer.innerHTML = '';
        if (data.savingsGoals && data.savingsGoals.length > 0) {
            data.savingsGoals.forEach(goal => {
                const percent = Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100));
                const html = `
                    <div class="goal-item">
                        <div class="goal-label">
                            <span>${goal.name}</span>
                            <span>${formatter.format(goal.current_amount)} / ${formatter.format(goal.target_amount)}</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${percent}%;"></div>
                        </div>
                    </div>
                `;
                goalsContainer.insertAdjacentHTML('beforeend', html);
            });
        } else {
            goalsContainer.innerHTML = '<p style="color:#777; font-size:0.9rem;">No savings goals set.</p>';
        }
    }
    }

    // Update Spending Bars
    const spendingContainer = document.getElementById('spending-bars');
    if (spendingContainer) {
        spendingContainer.innerHTML = '';
        
        // Map spending data by date string (YYYY-MM-DD)
        const spendingMap = {};
        if (data.spending) {
            data.spending.forEach(item => {
                const d = new Date(item.date);
                const dateStr = d.toISOString().split('T')[0];
                spendingMap[dateStr] = parseFloat(item.total);
            });
        }

        // Determine max value for scaling (min 100 to avoid huge bars for small amounts)
        const values = Object.values(spendingMap);
        const maxVal = values.length ? Math.max(...values, 100) : 100;
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        // Generate bars for last 7 days
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const dayName = days[d.getDay()];
            const amount = spendingMap[dateStr] || 0;
            
            // Calculate height in pixels (max 100px)
            const heightPx = Math.max((amount / maxVal) * 100, 4); 
            
            const html = `
                <div class="bar-item">
                    <div class="bar" style="height: ${heightPx}px;" title="$${amount.toFixed(2)}"></div>
                    <span class="bar-label">${dayName}</span>
                </div>
            `;
            spendingContainer.insertAdjacentHTML('beforeend', html);
        }
    }
}

// Unlink Account Function
window.unlinkAccount = (id) => {
    accountIdToUnlink = id;
    const modal = document.getElementById('unlink-modal');
    if (modal) modal.classList.add('active');
};

window.closeUnlinkModal = () => {
    const modal = document.getElementById('unlink-modal');
    if (modal) modal.classList.remove('active');
    accountIdToUnlink = null;
};

// Show In-place Zelle Receipt
function showInPlaceZelleReceipt(recipient, amount) {
    const zelleForm = document.getElementById('zelle-form');
    const zelleReceipt = document.getElementById('zelle-receipt');

    if (!zelleForm || !zelleReceipt) return;

    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    // Populate receipt
    document.getElementById('zelle-receipt-amount').textContent = formatter.format(amount);
    document.getElementById('zelle-receipt-recipient').textContent = recipient;
    document.getElementById('zelle-receipt-date').textContent = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    // Hide form, show receipt
    zelleForm.style.display = 'none';
    zelleReceipt.style.display = 'block';
}

// Reset Zelle card to show the form again
window.resetZelleView = function() {
    document.getElementById('zelle-receipt').style.display = 'none';
    const zelleForm = document.getElementById('zelle-form');
    zelleForm.reset();
    zelleForm.style.display = 'block';
}

// Fetch Full Transaction History
async function fetchTransactionHistory() {
    try {
        const response = await fetch('/api/transactions');
        if (!response.ok) return;
        const data = await response.json();
        
        // Store transactions globally for the view modal
        window.currentTransactions = data.transactions || [];

        const list = document.getElementById('full-transaction-list');
        if (!list) return;
        
        list.innerHTML = '';
        if (!data.transactions || data.transactions.length === 0) {
            list.innerHTML = '<p style="padding:20px; text-align:center; color:#666;">No transactions found.</p>';
            return;
        }

        const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

        data.transactions.forEach((tx, index) => {
            const isCredit = tx.type === 'Credit';
            const iconClass = isCredit ? 'fa-arrow-down' : 'fa-shopping-cart';
            const colorClass = isCredit ? 'income' : 'expense';
            const amountClass = isCredit ? 'positive' : 'negative';
            const sign = isCredit ? '+' : '-';
            
            const html = `
                <div class="transaction-item">
                    <div class="trans-icon ${colorClass}"><i class="fas ${iconClass}"></i></div>
                    <div class="trans-details">
                        <h4>${tx.description}</h4>
                        <span>${new Date(tx.date).toLocaleDateString()} • ${tx.account_name} (...${tx.account_number.slice(-4)})</span>
                    </div>
                    <div class="trans-amount ${amountClass}">${sign}${formatter.format(tx.amount)}</div>
                    <button class="secondary-btn" style="width: auto; padding: 6px 12px; font-size: 0.8rem; margin-left: 10px;" onclick="viewTransaction(${index})">View</button>
                </div>
            `;
            list.insertAdjacentHTML('beforeend', html);
        });

    } catch (err) {
        console.error('Error fetching history:', err);
        showToast('Failed to load history', 'error');
    }
}

// View Transaction Details
window.viewTransaction = (index) => {
    const tx = window.currentTransactions[index];
    if (!tx) return;

    const modal = document.getElementById('transaction-details-modal');
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

    document.getElementById('tx-detail-type').textContent = tx.type;
    document.getElementById('tx-detail-amount').textContent = formatter.format(tx.amount);
    document.getElementById('tx-detail-date').textContent = new Date(tx.date).toLocaleString();
    document.getElementById('tx-detail-desc').textContent = tx.description;
    document.getElementById('tx-detail-account').textContent = `${tx.account_name} (...${tx.account_number.slice(-4)})`;
    document.getElementById('tx-detail-id').textContent = `#${tx.id}`;

    modal.classList.add('active');
};

// Close Transaction Details Modal
window.closeTransactionModal = () => {
    const modal = document.getElementById('transaction-details-modal');
    if (modal) {
        modal.classList.remove('active');
    }
};

// Close modal when clicking outside
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('transaction-details-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                window.closeTransactionModal();
            }
        });
    }
});

// Handle Custom Dropdown Selection
window.selectDropdownOption = (dropdownId, value, text) => {
    const button = document.getElementById(dropdownId + '-button');
    const dropdown = document.getElementById(dropdownId + '-dropdown');
    
    if (!button || !dropdown) {
        showToast('Error: Dropdown not found', 'error');
        return;
    }
    
    const options = dropdown.querySelectorAll('.select-option');
    
    // Update selected option styling
    options.forEach(option => {
        option.classList.remove('selected');
        if (String(option.value) === String(value)) {
            option.classList.add('selected');
        }
    });
    
    // Update button text
    const textSpan = button.querySelector('.select-button-text');
    if (textSpan) {
        textSpan.textContent = text;
    }
    
    // Store value in hidden input for form submission
    const form = document.getElementById('transfer-form');
    if (form) {
        let hiddenInput = document.getElementById(dropdownId + '-value');
        if (!hiddenInput) {
            hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = dropdownId + '-value';
            hiddenInput.name = dropdownId;
            form.appendChild(hiddenInput);
        }
        hiddenInput.value = value;
    }
    
    // Close dropdown
    dropdown.classList.remove('active');
    button.classList.remove('active');
};

// Mark Notification as Read
window.markNotificationAsRead = async (notificationId, index, liElement) => {
    try {
        // If no ID, use index as fallback (for older notifications without IDs)
        const id = notificationId !== undefined && notificationId !== null ? notificationId : index;
        
        const response = await fetch(`/api/notifications/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_read: true })
        });

        if (response.ok) {
            // Update the specific notification element
            if (liElement && liElement.classList) {
                liElement.classList.remove('unread');
            }

            // Update badge count
            const badge = document.querySelector('.badge');
            const unreadItems = document.querySelectorAll('.notif-list li.unread');
            const unreadCount = unreadItems.length;
            
            if (badge) {
                badge.textContent = unreadCount;
                badge.style.display = unreadCount > 0 ? 'block' : 'none';
            }

            // Update stored notifications
            if (window.currentNotifications && window.currentNotifications[index]) {
                window.currentNotifications[index].is_read = true;
            }

            console.log('Notification marked as read successfully');
        } else {
            const error = await response.json();
            console.error('Error response:', error);
            showToast('Failed to update notification', 'error');
        }
    } catch (err) {
        console.error('Error marking notification as read:', err);
        showToast('Error updating notification', 'error');
    }
};