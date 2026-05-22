const authHost = window.location.hostname || 'localhost';
const AUTH_API_BASE = window.AUTH_API_BASE || `http://${authHost}:4000`;
const currentPath = window.location.pathname;
const isAuthPage = currentPath.endsWith('login.html') || currentPath.endsWith('signup.html');

window.isAuthenticating = false;

function splitFullName(fullName) {
    const trimmed = String(fullName || '').trim();
    if (!trimmed) {
        return { firstName: '', lastName: '' };
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
        return { firstName: parts[0], lastName: '' };
    }

    const lastName = parts.pop();
    return { firstName: parts.join(' '), lastName };
}

async function apiRequest(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    return fetch(`${AUTH_API_BASE}${path}`, {
        credentials: 'include',
        ...options,
        headers
    });
}

function applyUserToNav(user) {
    const navUserName = document.getElementById('navUserName');
    if (!navUserName) return;
    const nameParts = splitFullName(user.fullName || '');
    navUserName.textContent = nameParts.firstName || user.fullName || 'User';
}

function applyUserToProfile(user) {
    if (!currentPath.endsWith('profile.html')) return;

    const nameParts = splitFullName(user.fullName || '');
    const displayName = user.fullName || `${nameParts.firstName} ${nameParts.lastName}`.trim() || 'User';

    const displayNameEl = document.getElementById('profileDisplayName');
    const displayRoleEl = document.getElementById('profileDisplayRole');
    const firstNameEl = document.getElementById('profileFirstName');
    const lastNameEl = document.getElementById('profileLastName');
    const emailEl = document.getElementById('profileEmail');
    const contactEl = document.getElementById('profileContact');
    const roleEl = document.getElementById('profileRole');

    if (displayNameEl) displayNameEl.textContent = displayName;
    if (displayRoleEl) displayRoleEl.textContent = user.role || 'Technical Staff';
    if (firstNameEl) firstNameEl.value = nameParts.firstName || '';
    if (lastNameEl) lastNameEl.value = nameParts.lastName || '';
    if (emailEl) emailEl.value = user.email || '';
    if (contactEl) contactEl.value = user.contactNumber || '';
    if (roleEl) roleEl.value = user.role || 'Technical Staff';

    const saveBtn = document.getElementById('profileSaveBtn');
    if (!saveBtn) return;

    saveBtn.onclick = async () => {
        const newFirstName = firstNameEl ? firstNameEl.value.trim() : '';
        const newLastName = lastNameEl ? lastNameEl.value.trim() : '';
        const newContact = contactEl ? contactEl.value.trim() : '';

        if (!newFirstName || !newLastName) {
            alert('First and last name are required.');
            return;
        }

        try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            const response = await apiRequest('/api/auth/profile', {
                method: 'PUT',
                body: JSON.stringify({
                    firstName: newFirstName,
                    lastName: newLastName,
                    contactNumber: newContact
                })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Unable to save profile.');
            }

            const updatedUser = await response.json();
            applyUserToNav(updatedUser);
            applyUserToProfile(updatedUser);
            alert('Profile saved successfully!');
        } catch (error) {
            console.error('Profile update error:', error);
            alert(error.message || 'Error saving profile.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Profile';
        }
    };
}

async function loadSessionUser() {
    try {
        const response = await apiRequest('/api/auth/me');
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn('Auth: unable to reach server.', error);
        return null;
    }
}

async function initializeAuthState() {
    const user = await loadSessionUser();

    if (user) {
        if (isAuthPage && !window.isAuthenticating) {
            window.location.href = 'index.html';
            return;
        }

        applyUserToNav(user);
        applyUserToProfile(user);
        return;
    }

    if (!isAuthPage) {
        window.location.href = 'login.html';
    }
}

// ================== SIGNUP FORM ==================
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const firstName = document.getElementById('firstName').value;
        const lastName = document.getElementById('lastName').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const btn = signupForm.querySelector('button[type="submit"]');

        if (password !== confirmPassword) {
            alert("Passwords do not match.");
            return;
        }

        const nameRegex = /^[A-Za-z\s]+$/;
        if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
            alert("First and last names can only contain letters and spaces.");
            return;
        }

        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            alert("Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.");
            return;
        }

        try {
            window.isAuthenticating = true;
            btn.disabled = true;
            btn.textContent = 'Creating Account...';

            const response = await apiRequest('/api/auth/register', {
                method: 'POST',
                body: JSON.stringify({
                    firstName,
                    lastName,
                    email,
                    password
                })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Unable to create account.');
            }

            alert('Account created successfully!');
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Signup error:', error);
            alert(error.message || 'Unable to create account.');
            btn.disabled = false;
            btn.textContent = 'Register Account';
            window.isAuthenticating = false;
        }
    });
}

// ================== LOGIN FORM ==================
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const btn = loginForm.querySelector('button[type="submit"]');

        try {
            btn.disabled = true;
            btn.textContent = 'Signing In...';

            const response = await apiRequest('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || 'Invalid email or password.');
            }

            window.location.href = 'index.html';
        } catch (error) {
            console.error('Login error:', error);
            alert(error.message || 'Invalid email or password!');
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    });
}

// ================== LOGOUT FUNCTION ==================
window.appLogout = async function () {
    try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        window.location.href = 'login.html';
    }
};

initializeAuthState();