import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  remove,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyANLtTEL52HOhSSDiiva_8uPWxekW5p1b4",
  authDomain: "reservation-4824a.firebaseapp.com",
  databaseURL: "https://reservation-4824a-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "reservation-4824a",
  storageBucket: "reservation-4824a.firebasestorage.app",
  messagingSenderId: "1035306733095",
  appId: "1:1035306733095:web:e583b832aacd7176514802"
};

const app = initializeApp(firebaseConfig);

const database = getDatabase(app);

export {
  database,
  ref,
  set,
  push,
  onValue,
  remove,
  update
};
