/*
  classroom-hub-common.js
  ------------------------
  통합 교실 컨트롤 허브 — 5개 모듈(컨트롤러 UI / HUD / 소리센터 / 참여게임 / 호출)이
  공유하는 Firebase 초기화, 학교·학급 상수, Firestore 헬퍼, 공용 유틸리티 모음.

  ⚠️ 배포 전 꼭 확인하세요
  1) 아래 firebaseConfig 자리에 실제 Firebase 프로젝트 설정값을 넣어야 합니다.
     (Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서 복사)
  2) Firestore 보안 규칙은 classroom-hub/README.md 를 참고해 설정하세요.
  3) 학교명/학년·반 구조는 아래 SCHOOL / GRADES / CLASSES_PER_GRADE 상수에서 바로 수정할 수 있습니다.
*/

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// =====================================================================
// 1) Firebase 프로젝트 설정 — 여기를 실제 값으로 교체하세요
// =====================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyAQrW0iSjJQL1iANun1t5rip0viEa1qIUc",
  authDomain: "totalhub.firebaseapp.com",
  projectId: "totalhub",
  storageBucket: "totalhub.firebasestorage.app",
  messagingSenderId: "235632322089",
  appId: "1:235632322089:web:63791f241ea3e7c1195e38",
  measurementId: "G-74LJ1151KZ"
};

export const IS_CONFIG_READY = !String(firebaseConfig.apiKey).startsWith("REPLACE_WITH");

function getApp_(){ return getApps().length ? getApp() : initializeApp(firebaseConfig); }
export const db = IS_CONFIG_READY ? getFirestore(getApp_()) : null;

let authReadyPromise = null;
export function ensureAuth(){
  if(!IS_CONFIG_READY) return Promise.resolve(null);
  if(!authReadyPromise){
    authReadyPromise = signInAnonymously(getAuth(getApp_())).catch(e=>{ console.error("[classroom-hub] 익명 로그인 실패:", e); });
  }
  return authReadyPromise;
}

// =====================================================================
// 2) 학교 / 학년·반 구조 — 실제 학교 정보에 맞게 수정하세요
// =====================================================================
export const SCHOOL = {
  name: "한일여자고등학교",
  // NEIS 학교코드 조회 실패 시 수동으로 채워 넣을 수 있는 자리(선택)
  atptOfcdcScCode: "",   // 시도교육청코드 (예: 경상북도교육청 = "R10")
  sdSchulCode: ""        // 행정표준코드(학교코드)
};

// 학년별로 존재하는 반 목록. 필요에 맞게 자유롭게 수정하세요.
export const CLASSES_PER_GRADE = {
  1: [1,2,3,4,5,6,7,8,9,10],
  2: [1,2,3,4,5,6,7,8,9,10],
  3: [1,2,3,4,5,6,7,8,9,10]
};
export const GRADES = Object.keys(CLASSES_PER_GRADE).map(Number);

export function getClassId(grade, cls){ return `${grade}-${cls}`; }
export function parseClassId(classId){
  const [g,c] = String(classId).split("-").map(Number);
  return { grade: g, cls: c };
}
export function classLabel(grade, cls){ return `${grade}학년 ${cls}반`; }

// =====================================================================
// 3) 학급 선택 상태 — 컨트롤러/HUD/소리센터/참여게임이 localStorage로 공유
// =====================================================================
const LS_KEY = "classroomHub_selectedClass"; // { grade, cls }

export function getSelectedClass(){
  try {
    const raw = localStorage.getItem(LS_KEY);
    if(raw) return JSON.parse(raw);
  } catch(e){}
  return { grade: GRADES[0], cls: CLASSES_PER_GRADE[GRADES[0]][0] };
}
export function setSelectedClass(grade, cls){
  localStorage.setItem(LS_KEY, JSON.stringify({ grade: Number(grade), cls: Number(cls) }));
}

// =====================================================================
// 4) 컨트롤러 ↔ HUD 실시간 state (classroomHub_state/{classId})
//    { presetId, activityName, mode: 'idle'|'running'|'paused'|'ended',
//      durationSec, startedAt(ms), pausedRemainingSec, soundThresholdDb,
//      ttsMessage, ttsNonce, updatedAt }
// =====================================================================
export function subscribeState(classId, cb){
  if(!db) return () => {};
  return onSnapshot(doc(db, "classroomHub_state", classId), snap=>{
    cb(snap.exists() ? snap.data() : null);
  }, err=>console.error("[classroom-hub] state 구독 오류:", err));
}
export async function setState(classId, data){
  if(!db) return;
  await ensureAuth();
  await setDoc(doc(db, "classroomHub_state", classId), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// =====================================================================
// 5) 활동 프리셋 (classroomHub_presets/list 문서 하나에 배열로 저장)
// =====================================================================
const DEFAULT_PRESETS = [
  { id: "read",   name: "조용히 읽기",   durationSec: 600,  soundThresholdDb: 45, icon: "📖" },
  { id: "group",  name: "모둠 활동",     durationSec: 900,  soundThresholdDb: 60, icon: "👥" },
  { id: "quiz",   name: "문제 풀이",     durationSec: 480,  soundThresholdDb: 40, icon: "✏️" },
  { id: "clean",  name: "정리 정돈",     durationSec: 300,  soundThresholdDb: 65, icon: "🧹" },
  { id: "free",   name: "자유 활동",     durationSec: 0,    soundThresholdDb: 70, icon: "⭐" }
];
export function subscribePresets(cb){
  if(!db){ cb(DEFAULT_PRESETS); return () => {}; }
  return onSnapshot(doc(db, "classroomHub_presets", "list"), snap=>{
    cb(snap.exists() && Array.isArray(snap.data().presets) ? snap.data().presets : DEFAULT_PRESETS);
  }, err=>{ console.error("[classroom-hub] presets 구독 오류:", err); cb(DEFAULT_PRESETS); });
}
export async function savePresets(presets){
  if(!db) return;
  await ensureAuth();
  await setDoc(doc(db, "classroomHub_presets", "list"), { presets });
}

// =====================================================================
// 6) 참여게임 — 모둠/학생 포인트 (classroomHub_participation/{classId})
//    { groups: [{name, points}], students: [{name, points}] }
// =====================================================================
export function subscribeParticipation(classId, cb){
  if(!db){ cb({ groups: [], students: [] }); return () => {}; }
  return onSnapshot(doc(db, "classroomHub_participation", classId), snap=>{
    cb(snap.exists() ? snap.data() : { groups: [], students: [] });
  }, err=>console.error("[classroom-hub] participation 구독 오류:", err));
}
export async function saveParticipation(classId, data){
  if(!db) return;
  await ensureAuth();
  await setDoc(doc(db, "classroomHub_participation", classId), data, { merge: true });
}

// =====================================================================
// 7) 호출(calls) — 교무실 등에서 HUD로 보내는 알림
//    문서: { teacherName, location, message, targetAll(bool),
//            targetClasses: ["2-9", "3-1", ...], createdAt, active }
// =====================================================================
export async function sendCall({ teacherName, location, message, targetAll, targetClasses }){
  if(!db) return;
  await ensureAuth();
  await addDoc(collection(db, "calls"), {
    teacherName: teacherName || "",
    location: location || "",
    message: message || "",
    targetAll: !!targetAll,
    targetClasses: targetAll ? [] : (targetClasses || []),
    active: true,
    createdAt: serverTimestamp()
  });
}

// HUD가 자기 classId에 해당하는 "활성" 최신 호출을 구독
export function subscribeCallsForClass(classId, cb){
  if(!db) return () => {};
  const qy = query(
    collection(db, "calls"),
    where("active", "==", true),
    orderBy("createdAt", "desc"),
    limit(20)
  );
  return onSnapshot(qy, snap=>{
    const rows = [];
    snap.forEach(d=>{
      const data = d.data();
      if(data.targetAll || (Array.isArray(data.targetClasses) && data.targetClasses.includes(classId))){
        rows.push({ id: d.id, ...data });
      }
    });
    cb(rows);
  }, err=>console.error("[classroom-hub] calls 구독 오류:", err));
}

// 교무실 화면에서 최근 발신 이력을 볼 때 사용(선택)
export function subscribeRecentCalls(cb, max = 30){
  if(!db) return () => {};
  const qy = query(collection(db, "calls"), orderBy("createdAt", "desc"), limit(max));
  return onSnapshot(qy, snap=>{
    const rows = [];
    snap.forEach(d=>rows.push({ id: d.id, ...d.data() }));
    cb(rows);
  }, err=>console.error("[classroom-hub] calls 이력 구독 오류:", err));
}

export async function acknowledgeCall(callId){
  if(!db) return;
  await ensureAuth();
  await updateDoc(doc(db, "calls", callId), { active: false, acknowledgedAt: serverTimestamp() });
}

// =====================================================================
// 8) 공용 TTS 유틸
// =====================================================================
export function speak(text, { rate = 1, pitch = 1, voiceNameIncludes = "" } = {}){
  if(!text || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR"; u.rate = rate; u.pitch = pitch;
  if(voiceNameIncludes){
    const v = window.speechSynthesis.getVoices().find(v=>v.name.includes(voiceNameIncludes));
    if(v) u.voice = v;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

// =====================================================================
// 9) 기타 유틸
// =====================================================================
export function fmtClock(d = new Date()){
  return d.toLocaleTimeString("ko-KR", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false });
}
export function fmtDate(d = new Date()){
  return d.toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric", weekday:"long" });
}
export function fmtCountdown(sec){
  sec = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(sec/60)).padStart(2,"0");
  const s = String(sec%60).padStart(2,"0");
  return `${m}:${s}`;
}
