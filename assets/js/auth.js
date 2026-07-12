/* =====================================================================
   auth.js — Firebase Authentication（Googleログイン）
   Firebase は Auth のみ使用（Firestore 等のデータストアは使わない）。
   ここで取得した ID トークンは Worker 側で Web Crypto により検証され、
   お気に入り機能（/api/favorites）の認可に使われる。
   Firebase の Web 設定値（apiKey 等）は公開情報であり秘匿不要。
   ===================================================================== */
(function (global) {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyDr4ujQOf-CFboo5S1vOhARXxV291X0Ojc",
    authDomain: "todo-tracker-25501.firebaseapp.com",
    projectId: "todo-tracker-25501",
    storageBucket: "todo-tracker-25501.firebasestorage.app",
    messagingSenderId: "1065503949697",
    appId: "1:1065503949697:web:f90cb340d4df3b4c5cde80"
  };

  var inited = false;
  var currentUser = null;
  var listeners = [];

  function available() { return typeof firebase !== "undefined"; }

  function init() {
    if (inited || !available()) return;
    inited = true;
    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(function (user) {
      currentUser = user;
      listeners.forEach(function (cb) { try { cb(user); } catch (e) {} });
    });
  }

  // サインイン状態の変化を購読する。登録時点で現在の状態を1回コールバックする。
  function onChange(cb) {
    listeners.push(cb);
    if (inited) { try { cb(currentUser); } catch (e) {} }
  }

  function signIn() {
    if (!available()) return Promise.reject(new Error("Firebase SDK の読み込みに失敗しました。"));
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithPopup(provider);
  }

  function signOut() {
    if (!available()) return Promise.resolve();
    return firebase.auth().signOut();
  }

  function getCurrentUser() { return currentUser; }

  // Worker への API 呼び出しに使う ID トークン（自動更新。未ログイン時は null）
  function getIdToken(forceRefresh) {
    if (!currentUser) return Promise.resolve(null);
    return currentUser.getIdToken(!!forceRefresh).catch(function () { return null; });
  }

  global.Auth = {
    init: init,
    onChange: onChange,
    signIn: signIn,
    signOut: signOut,
    getCurrentUser: getCurrentUser,
    getIdToken: getIdToken
  };
})(window);
