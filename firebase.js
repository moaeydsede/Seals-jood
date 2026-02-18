// firebase.js - dynamic init from localStorage
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, limit, getDocs, where, serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";

export const Firebase = {
  app: null, db: null, auth: null, storage: null,
  ready: false,
  configKey: "ERP_FIREBASE_CONFIG_V1",
};

export function loadSavedConfig(){
  try{
    const raw = localStorage.getItem(Firebase.configKey);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}

export function saveConfig(cfg){
  localStorage.setItem(Firebase.configKey, JSON.stringify(cfg, null, 2));
}

export function initFirebaseFromSaved(){
  try{
    let cfg = null;
    try{ cfg = JSON.parse(localStorage.getItem('ERP_FIREBASE_CONFIG')||'null'); }catch(_e){ cfg = null; }
    if(!cfg || !cfg.apiKey || !cfg.projectId){
      // Use baked-in config for Seals-jood
      cfg = DEFAULT_FIREBASE_CONFIG;
      localStorage.setItem('ERP_FIREBASE_CONFIG', JSON.stringify(cfg));
    }
    return initFirebase(cfg);
  }catch(e){
    console.error(e);
    return { ok:false, error:String(e) };
  }
}

// ---------- helpers ----------
export async function getRole(uid){
  if(!uid) return "guest";
  const r = await getDoc(doc(Firebase.db, "users", uid));
  if(!r.exists()) return "user";
  return (r.data().role || "user");
}

export async function ensureUserDoc(user){
  if(!user) return;
  const dref = doc(Firebase.db, "users", user.uid);
  const snap = await getDoc(dref);
  if(!snap.exists()){
    await setDoc(dref, {
      email: user.email || "",
      role: "user",
      createdAt: serverTimestamp()
    }, { merge:true });
  }
}

export async function nextCounter(name){
  const cref = doc(Firebase.db, "counters", name);
  return await runTransaction(Firebase.db, async (tx) => {
    const snap = await tx.get(cref);
    const curr = snap.exists() ? (snap.data().value || 0) : 0;
    const next = curr + 1;
    tx.set(cref, { value: next, updatedAt: serverTimestamp() }, { merge:true });
    return next;
  });
}

export {
  // Firestore
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, orderBy, limit, getDocs, where, serverTimestamp,
  // Auth
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  // Storage
  sRef, uploadBytes, getDownloadURL
};
