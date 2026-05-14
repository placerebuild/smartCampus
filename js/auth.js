import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import {
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";

// ================== fIREBASE CONFIG ==================
const firebaseConfig = {
    apiKey: "AIzaSyBHT49RayxsqQcHjy8eUr_kaO9fTgVRrkI",
    authDomain: "smartcampus-7ab39.firebaseapp.com",
    projectId: "smartcampus-7ab39",
    storageBucket: "smartcampus-7ab39.firebasestorage.app",
    messagingSenderId: "575231840475",
    appId: "1:575231840475:web:89b7d09d4defbe244dbcfe",
    measurementId: "G-76MCXMF3KV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.firebaseAuth = auth;
window.firebaseDb = db;

const currentPath = window.location.pathname;
const isAuthPage = currentPath.endsWith('login.html') || currentPath.endsWith('signup.html');

window.isAuthenticating = false;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // User is logged in
        if (isAuthPage && !window.isAuthenticating) {
            window.location.href = 'index.html';
            return;
        }

        // Fetch user data from Firestore
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();

                const navUserName = document.getElementById('navUserName');
                if (navUserName) {
                    navUserName.textContent = userData.firstName || "User";
                }

                if (currentPath.endsWith('profile.html')) {
                    document.getElementById('profileDisplayName').textContent = `${userData.firstName} ${userData.lastName}`;
                    document.getElementById('profileDisplayRole').textContent = userData.role || "Technical Staff";

                    document.getElementById('profileFirstName').value = userData.firstName || "";
                    document.getElementById('profileLastName').value = userData.lastName || "";
                    document.getElementById('profileEmail').value = userData.email || "";
                    document.getElementById('profileContact').value = userData.contactNumber || "";
                    document.getElementById('profileRole').value = userData.role || "Technical Staff";

                    // Attach Save Listener
                    const saveBtn = document.getElementById('profileSaveBtn');
                    if (saveBtn) {
                        saveBtn.onclick = async () => {
                            const newFirstName = document.getElementById('profileFirstName').value;
                            const newLastName = document.getElementById('profileLastName').value;
                            const newContact = document.getElementById('profileContact').value;

                            try {
                                saveBtn.disabled = true;
                                saveBtn.textContent = "Saving...";

                                await updateDoc(userDocRef, {
                                    firstName: newFirstName,
                                    lastName: newLastName,
                                    contactNumber: newContact
                                });

                                document.getElementById('profileDisplayName').textContent = `${newFirstName} ${newLastName}`;
                                if (navUserName) navUserName.textContent = newFirstName;

                                alert("Profile saved successfully!");
                            } catch (error) {
                                console.error("Error updating profile:", error);
                                alert("Error saving profile: " + error.message);
                            } finally {
                                saveBtn.disabled = false;
                                saveBtn.textContent = "Save Profile";
                            }
                        };
                    }
                }
            }
        } catch (error) {
            console.error("Error fetching user data:", error);
        }

    } else {
        // User is logged out
        if (!isAuthPage) {
            window.location.href = 'login.html';
        }
    }
});

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

            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            await setDoc(doc(db, "users", user.uid), {
                firstName: firstName,
                lastName: lastName,
                email: email,
                role: "Technical Staff",
                contactNumber: "",
                createdAt: new Date().toISOString()
            });

            alert("Account created successfully!");
            window.location.href = 'index.html';

        } catch (error) {
            console.error("Signup error:", error);
            alert("Error: " + error.message);
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

            await signInWithEmailAndPassword(auth, email, password);
            // Redirect handled automatically by onAuthStateChanged

        } catch (error) {
            console.error("Login error:", error);
            alert("Invalid email or password!");
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    });
}

// ================== LOGOUT FUNCTION ==================
window.firebaseLogout = async function () {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Logout error:", error);
        alert("Error logging out: " + error.message);
    }
};