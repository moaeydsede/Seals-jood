// Firebase init (modular v10)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, orderBy, limit,
  addDoc, serverTimestamp, Timestamp, writeBatch, runTransaction, increment, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const firebaseConfig = {
  "apiKey": "AIzaSyBXgvwhcqxAtqsnYtesNBCt__bCxdZ257k",
  "authDomain": "matgr-mo.firebaseapp.com",
  "projectId": "matgr-mo",
  "storageBucket": "matgr-mo.firebasestorage.app",
  "messagingSenderId": "641264741412",
  "appId": "1:641264741412:web:040652521ebe4172c33cb1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(()=>{});

export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, orderBy, limit,
  addDoc, serverTimestamp, Timestamp, writeBatch, runTransaction, increment, deleteDoc
};
