import { auth, db } from './firebase.js';
import { 
  onAuthStateChanged, signInWithEmailAndPassword, signOut 
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function watchAuth(cb){
  return onAuthStateChanged(auth, async (user)=>{
    if(!user){ cb(null, null); return; }
    const ref = doc(db,'users', user.uid);
    const snap = await getDoc(ref);
    const profile = snap.exists() ? snap.data() : null;
    cb(user, profile ? ({uid:user.uid, email:user.email, ...profile}) : ({uid:user.uid, email:user.email, role:'user', active:false}));
  });
}

export async function login(email, password){
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout(){
  return signOut(auth);
}
