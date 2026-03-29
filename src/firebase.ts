import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged as firebaseOnAuthStateChanged, User } from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  runTransaction,
  Timestamp,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const isConfigValid = firebaseConfig && 
  firebaseConfig.projectId && 
  !firebaseConfig.projectId.includes('remixed-') &&
  firebaseConfig.apiKey && 
  !firebaseConfig.apiKey.includes('remixed-');

let app;
let db: any;
let auth: any;
let googleProvider: any;

if (isConfigValid) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
  } catch (e) {
    console.error("Firebase initialization failed:", e);
  }
} else {
  console.warn("Firebase configuration is invalid or missing. Online features will be disabled.");
  // Mock implementations to prevent crashes
  db = {};
  auth = {
    currentUser: null,
    onAuthStateChanged: (callback: any) => {
      callback(null);
      return () => {};
    },
    signOut: async () => {},
  };
  googleProvider = {};
}

export { db, auth, googleProvider, isConfigValid };

// Error Handling Spec for Firestore Operations
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export let isQuotaExceeded = false;
const quotaListeners: ((exceeded: boolean) => void)[] = [];

export function onQuotaExceededChange(callback: (exceeded: boolean) => void) {
  quotaListeners.push(callback);
  callback(isQuotaExceeded);
  return () => {
    const index = quotaListeners.indexOf(callback);
    if (index > -1) quotaListeners.splice(index, 1);
  };
}

function setQuotaExceeded(value: boolean) {
  if (isQuotaExceeded !== value) {
    isQuotaExceeded = value;
    quotaListeners.forEach(cb => cb(value));
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Check for quota exceeded error
  if (errorMessage.includes('resource-exhausted') || errorMessage.includes('Quota limit exceeded')) {
    setQuotaExceeded(true);
    const quotaMsg = "Firestore daily quota exceeded. This usually happens when many large levels are uploaded in a single day. The quota will reset at midnight Pacific Time. Please try again tomorrow or contact the developer.";
    console.error('Firestore Quota Exceeded:', errorMessage);
    throw new Error(JSON.stringify({
      error: quotaMsg,
      originalError: errorMessage,
      operationType,
      path
    }));
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate Connection to Firestore
async function testConnection() {
  if (!isConfigValid) return;
  const testPath = 'test/connection';
  try {
    await getDocFromServer(doc(db, testPath));
    console.log("Firestore connection test successful.");
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    } else {
      console.error(`Firestore connection test failed on path "${testPath}":`, error);
    }
  }
}
testConnection();

export const ensureUserProfile = async (user: User) => {
  if (!isConfigValid) return null;
  const userDocRef = doc(db, 'users', user.uid);
  let userDoc;
  try {
    userDoc = await getDoc(userDocRef);
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    } catch (e) {}
  }
  
  if (!userDoc?.exists()) {
    // Get next creator ID from counter
    const counterRef = doc(db, 'counters', 'users');
    let creatorId = 1;
    
    try {
      await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        if (!counterDoc.exists()) {
          transaction.set(counterRef, { count: 1 });
          creatorId = 1;
        } else {
          const newCount = (counterDoc.data()?.count || 0) + 1;
          transaction.update(counterRef, { count: newCount });
          creatorId = newCount;
        }
      });
    } catch (error) {
      // If transaction fails because document doesn't exist (though we handle it), 
      // or other permission issues, we log it.
      try {
        handleFirestoreError(error, OperationType.WRITE, 'counters/users (transaction)');
      } catch (e) {}
    }

    try {
      const profileData = {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous Creator',
        photoURL: user.photoURL || '',
        creatorId: creatorId,
        createdAt: new Date().toISOString()
      };
      await setDoc(userDocRef, profileData);
      return profileData;
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}`);
      } catch (e) {}
    }
  }
  return userDoc?.data();
};

// Authentication Helpers
export const loginWithGoogle = async () => {
  if (!isConfigValid) {
    alert("Online features are disabled because Firebase is not configured. Please set up Firebase in the AI Studio settings to enable Google Login.");
    return null;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureUserProfile(result.user);
    return result.user;
  } catch (error) {
    console.error('Login error:', error);
    throw error;
  }
};

export const logout = () => {
  if (!isConfigValid) return Promise.resolve();
  return signOut(auth);
};

export const onAuthStateChanged = (authInstance: any, callback: any) => {
  if (!isConfigValid) {
    callback(null);
    return () => {};
  }
  return firebaseOnAuthStateChanged(authInstance, callback);
};
export type { User };
export { 
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  increment,
  Timestamp
};
