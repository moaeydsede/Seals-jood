import { db } from './firebase.js';
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export async function logAudit(me, action, meta={}){
  try{
    await addDoc(collection(db,'auditLogs'),{
      action,
      byUid: me?.uid || null,
      byName: me?.displayName || me?.email || 'unknown',
      at: serverTimestamp(),
      meta
    });
  }catch(e){
    // silent
    console.warn('audit failed', e);
  }
}
