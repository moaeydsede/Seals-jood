// Firebase init (v10 modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const firebaseConfig = {
  "apiKey": "AIzaSyCe2W80FgybECOwF-55fUBZhxzTOYjpcUQ",
  "authDomain": "seals-jood.firebaseapp.com",
  "projectId": "seals-jood",
  "storageBucket": "seals-jood.firebasestorage.app",
  "messagingSenderId": "835360944508",
  "appId": "1:835360944508:web:dec8cf1d16830553d334f9"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
