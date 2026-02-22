// Firebase CDN version
// NOTE: Keep the same version across all imports (firebase.js + app.js)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBXgvwhcqxAtqsnYtesNBCt__bCxdZ257k",
  authDomain: "matgr-mo.firebaseapp.com",
  projectId: "matgr-mo",
  storageBucket: "matgr-mo.firebasestorage.app",
  messagingSenderId: "641264741412",
  appId: "1:641264741412:web:040652521ebe4172c33cb1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
