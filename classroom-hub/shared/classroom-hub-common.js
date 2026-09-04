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
// 급식 사진/PDF는 Firebase Storage(유료 Blaze 요금제 필요) 대신, 무료(Spark) 요금제로도
// 되는 Firestore에 압축된 이미지를 직접 저장하는 방식을 씁니다. (아래 11번 섹션 참고)

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
export function subscribeCallsForClass(classId, cb, onError){
  if(!db) return () => {};
  // 주의: where + orderBy를 같이 쓰면 Firestore 복합 색인이 필요해져서(콘솔에서
  // 별도로 만들어줘야 함) 조용히 실패할 수 있다. orderBy는 빼고 클라이언트에서
  // 정렬해서, 색인 설정 없이도 항상 동작하도록 함.
  const qy = query(
    collection(db, "calls"),
    where("active", "==", true)
  );
  return onSnapshot(qy, snap=>{
    const rows = [];
    snap.forEach(d=>{
      const data = d.data();
      if(data.targetAll || (Array.isArray(data.targetClasses) && data.targetClasses.includes(classId))){
        rows.push({ id: d.id, ...data });
      }
    });
    rows.sort((a, b) => {
      const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bt - at;
    });
    cb(rows);
  }, err => {
    console.error("[classroom-hub] calls 구독 오류:", err);
    if(onError) onError(err);
  });
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

// =====================================================================
// 10) 수동 등록(관리자 입력) — 시간표(학급별) / 학사일정(전체 학급 공통)
//     NEIS API에 정보가 없거나 부족할 때 선생님이 admin.html에서 직접 입력한
//     내용을 HUD 대기화면에서 나이스 정보와 함께(또는 대신) 보여준다.
// =====================================================================
export const MANUAL_TIMETABLE_DAY_KEYS = ["mon","tue","wed","thu","fri"];
export const MANUAL_TIMETABLE_DAY_LABELS = { mon:"월", tue:"화", wed:"수", thu:"목", fri:"금" };

// 학급별 주간 시간표: classroomHub_manualTimetable/{classId}
// { days: { mon:[{period,subject}], tue:[...], wed:[...], thu:[...], fri:[...] } }
export function subscribeManualTimetable(classId, cb){
  if(!db){ cb({ days:{} }); return () => {}; }
  return onSnapshot(doc(db, "classroomHub_manualTimetable", classId), snap=>{
    cb(snap.exists() ? snap.data() : { days:{} });
  }, err=>console.error("[classroom-hub] manualTimetable 구독 오류:", err));
}
export async function saveManualTimetable(classId, days){
  if(!db) return;
  await ensureAuth();
  await setDoc(doc(db, "classroomHub_manualTimetable", classId), { days, updatedAt: serverTimestamp() });
}

// 전체 학급 공통 학사일정: classroomHub_manualSchedule/{autoId} — { date:"YYYYMMDD", name, createdAt }
// classId로 구분하지 않는 컬렉션이라 등록하면 자동으로 모든 학급 HUD에 동일하게 반영된다.
export function subscribeManualSchedule(cb){
  if(!db){ cb([]); return () => {}; }
  const qy = query(collection(db, "classroomHub_manualSchedule"), orderBy("date", "asc"));
  return onSnapshot(qy, snap=>{
    const rows = [];
    snap.forEach(d=>rows.push({ id: d.id, ...d.data() }));
    cb(rows);
  }, err=>console.error("[classroom-hub] manualSchedule 구독 오류:", err));
}
export async function addManualScheduleEntry({ date, name }){
  if(!db) return;
  await ensureAuth();
  await addDoc(collection(db, "classroomHub_manualSchedule"), { date, name, createdAt: serverTimestamp() });
}
export async function deleteManualScheduleEntry(id){
  if(!db) return;
  await ensureAuth();
  await deleteDoc(doc(db, "classroomHub_manualSchedule", id));
}

// =====================================================================
// 11) 급식 메뉴 사진/PDF 업로드 — 나이스 대신(또는 함께) 그날 급식판 이미지를 보여줌
//     classroomHub_mealUploads/{date}  { url(=data URL), fileName, contentType, uploadedAt }
//     date로 문서를 구분하므로, 해당 날짜가 오면 HUD가 자동으로 그 파일을 보여준다.
//     전체 학급 공통(학급으로 구분하지 않음) — 급식은 원래 학교 전체 공통이라 자연스러움.
//
//     ⚠️ Firebase Storage는 유료(Blaze) 요금제가 있어야 켤 수 있어서, 대신 무료(Spark)
//     요금제에서도 되는 Firestore에 "압축한 사진을 데이터로 직접" 저장하는 방식을 씁니다.
//     Firestore 문서 하나의 용량 제한이 1MB라서, 사진은 자동으로 줄여서 저장하고
//     (보통 몇백 KB면 충분히 알아볼 수 있어요), PDF는 원본 그대로라 용량이 크면 저장이 안 될 수 있어요.
// =====================================================================
const MEAL_FILE_MAX_BYTES = 700000; // 원본(압축 후) 기준 약 700KB — data URL(base64)로 바뀌면 약 1MB 내외

function readFileAsDataUrl(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    img.src = dataUrl;
  });
}

// 사진 파일을 캔버스로 다시 그려서 용량을 줄인 JPEG data URL로 변환.
// 한 번에 안 줄어들면 화질/크기를 단계적으로 더 낮춰가며 여러 번 시도한다.
async function compressImageToDataUrl(file){
  const original = await readFileAsDataUrl(file);
  const img = await loadImage(original);
  const attempts = [
    { maxDim: 1400, quality: 0.75 },
    { maxDim: 1100, quality: 0.6 },
    { maxDim: 900,  quality: 0.5 },
    { maxDim: 700,  quality: 0.4 }
  ];
  for(const { maxDim, quality } of attempts){
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const outUrl = canvas.toDataURL("image/jpeg", quality);
    const approxBytes = Math.ceil((outUrl.length - outUrl.indexOf(",") - 1) * 3 / 4);
    if(approxBytes <= MEAL_FILE_MAX_BYTES) return outUrl;
  }
  throw new Error("사진 용량이 너무 커서 줄여도 저장할 수 없어요. 더 작은 사진으로 다시 시도해주세요.");
}

export async function uploadMealFile(date, file){
  if(!db) throw new Error("Firebase 설정이 아직 준비되지 않았습니다.");
  await ensureAuth();

  const isImage = (file.type || "").startsWith("image/");
  let dataUrl, contentType;
  if(isImage){
    dataUrl = await compressImageToDataUrl(file);
    contentType = "image/jpeg";
  } else {
    dataUrl = await readFileAsDataUrl(file);
    const approxBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
    if(approxBytes > MEAL_FILE_MAX_BYTES){
      throw new Error("PDF 용량이 너무 커요(약 " + Math.round(approxBytes/1024) + "KB). 무료 저장 방식은 파일당 약 700KB까지만 가능해요 — 사진(JPG/PNG)으로 올리시거나 더 작은 PDF로 시도해주세요.");
    }
    contentType = file.type || "application/octet-stream";
  }

  await setDoc(doc(db, "classroomHub_mealUploads", date), {
    url: dataUrl, fileName: file.name,
    contentType, uploadedAt: serverTimestamp()
  });
  return dataUrl;
}

export function subscribeMealUpload(date, cb){
  if(!db){ cb(null); return () => {}; }
  return onSnapshot(doc(db, "classroomHub_mealUploads", date), snap=>{
    cb(snap.exists() ? snap.data() : null);
  }, err=>console.error("[classroom-hub] mealUpload 구독 오류:", err));
}

// 관리자 화면에서 등록된 급식 이미지 목록을 날짜순으로 보여줄 때 사용
export function subscribeMealUploadsList(cb){
  if(!db){ cb([]); return () => {}; }
  const qy = query(collection(db, "classroomHub_mealUploads"), orderBy("__name__", "desc"));
  return onSnapshot(qy, snap=>{
    const rows = [];
    snap.forEach(d=>rows.push({ id: d.id, ...d.data() }));
    cb(rows);
  }, err=>console.error("[classroom-hub] mealUploadsList 구독 오류:", err));
}

export async function deleteMealUpload(date){
  if(!db) return;
  await ensureAuth();
  await deleteDoc(doc(db, "classroomHub_mealUploads", date));
}
