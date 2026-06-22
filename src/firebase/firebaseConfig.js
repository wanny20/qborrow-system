import { initializeApp, getApps } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  inMemoryPersistence,
  initializeAuth,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAHfVJXCkhXX6qRM8rGBj5UVzU000JFvf4",
  authDomain: "qborrow-b68ad.firebaseapp.com",
  projectId: "qborrow-b68ad",
  storageBucket: "qborrow-b68ad.firebasestorage.app",
  messagingSenderId: "204726630141",
  appId: "1:204726630141:web:46453a829a3854eb72f094",
  measurementId: "G-JQR18BTGE9"
};

const app =
  getApps().find((firebaseApp) => firebaseApp.name === "[DEFAULT]") ||
  initializeApp(firebaseConfig);

const secondaryApp =
  getApps().find((firebaseApp) => firebaseApp.name === "Secondary") ||
  initializeApp(firebaseConfig, "Secondary");

function getPersistentAuth(firebaseApp) {
  try {
    return initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
    });
  } catch (error) {
    if (error.code === "auth/already-initialized") {
      return getAuth(firebaseApp);
    }

    throw error;
  }
}

function getSecondaryAuth(firebaseApp) {
  try {
    return initializeAuth(firebaseApp, {
      persistence: inMemoryPersistence,
    });
  } catch (error) {
    if (error.code === "auth/already-initialized") {
      return getAuth(firebaseApp);
    }

    throw error;
  }
}

const auth = getPersistentAuth(app);
const secondaryAuth = getSecondaryAuth(secondaryApp);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

export { auth, secondaryAuth, db, storage, functions };
export default app;