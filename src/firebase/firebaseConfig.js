import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAHfVJXCkhXX6qRM8rGBj5UVzU000JFvf4",
  authDomain: "qborrow-b68ad.firebaseapp.com",
  projectId: "qborrow-b68ad",
  storageBucket: "qborrow-b68ad.firebasestorage.app",
  messagingSenderId: "204726630141",
  appId: "1:204726630141:web:46453a829a3854eb72f094",
  measurementId: "G-JQR18BTGE9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const secondaryApp =
  getApps().find((firebaseApp) => firebaseApp.name === "Secondary") ||
  initializeApp(firebaseConfig, "Secondary");

const auth = getAuth(app);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, secondaryAuth, db, storage };
export default app;