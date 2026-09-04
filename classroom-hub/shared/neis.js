/*
  neis.js
  --------
  NEIS Open API(open.neis.go.kr) 연동 모듈 — 급식/시간표/학사일정 + 학교코드 조회.

  ⚠️ 사용 전 확인
  1) NEIS_KEY 자리에 open.neis.go.kr 에서 발급받은 인증키를 넣으세요.
     (키 없이도 호출은 되지만 트래픽 제한이 매우 낮아 실사용에는 발급을 권장합니다.
      발급 방법은 classroom-hub/README.md 참고)
  2) 브라우저에서 직접 호출 시 NEIS 서버 상태에 따라 CORS가 막힐 수 있습니다.
     이 경우 README의 "NEIS 프록시" 안내를 참고해 간단한 프록시(Cloud Function 등)를
     하나 두고 NEIS_BASE 만 그 프록시 주소로 바꿔주면 됩니다.
  3) 이 모듈은 고등학교(HIS) 시간표 API를 사용합니다. 중/초등학교라면
     misTimetable / elsTimetable 로 바꾸세요.
*/

export const NEIS_KEY = "REPLACE_WITH_YOUR_NEIS_KEY"; // 없으면 빈 문자열("")로 두면 KEY 파라미터 없이 호출
export const NEIS_BASE = "https://open.neis.go.kr/hub";

function withKey(params){
  const p = { ...params, Type: "json", pIndex: 1, pSize: 100 };
  if(NEIS_KEY && !NEIS_KEY.startsWith("REPLACE_WITH")) p.KEY = NEIS_KEY;
  return p;
}

async function callNeis(endpoint, params){
  const url = new URL(`${NEIS_BASE}/${endpoint}`);
  const qp = withKey(params);
  Object.entries(qp).forEach(([k,v])=>{ if(v !== undefined && v !== null && v !== "") url.searchParams.set(k, v); });

  const res = await fetch(url.toString());
  if(!res.ok) throw new Error(`NEIS 호출 실패 (${res.status})`);
  const json = await res.json();

  const root = json[endpoint];
  if(!root) {
    // RESULT만 오는 경우(데이터 없음/오류 코드)
    const result = json.RESULT || (json[Object.keys(json)[0]] && json[Object.keys(json)[0]][0] && json[Object.keys(json)[0]][0].RESULT);
    return { rows: [], code: result?.CODE || "UNKNOWN", message: result?.MESSAGE || "결과 없음" };
  }
  const head = root[0]?.head || [];
  const result = head.find(h=>h.RESULT)?.RESULT;
  const rows = root[1]?.row || [];
  return { rows, code: result?.CODE || "INFO-000", message: result?.MESSAGE || "정상" };
}

// yyyymmdd 문자열
export function ymd(date = new Date()){
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}${m}${d}`;
}

// =====================================================================
// 학교코드 조회 — 학교명으로 ATPT_OFCDC_SC_CODE / SD_SCHUL_CODE 를 찾는다
// =====================================================================
const LS_SCHOOL_CODE_KEY = "classroomHub_neisSchoolCode";

export async function findSchoolByName(schoolName){
  const { rows } = await callNeis("schoolInfo", { SCHUL_NM: schoolName });
  return rows.map(r=>({
    officeCode: r.ATPT_OFCDC_SC_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    schoolCode: r.SD_SCHUL_CODE,
    schoolName: r.SCHUL_NM,
    address: r.ORG_RDNMA
  }));
}

// SCHOOL 상수(수동 코드)가 채워져 있으면 그걸 쓰고, 없으면 이름으로 검색해서
// localStorage에 캐시. 검색 결과가 여러 개면 첫 번째 결과를 쓰되 콘솔에 후보를 출력.
export async function resolveSchoolCodes(SCHOOL){
  if(SCHOOL.atptOfcdcScCode && SCHOOL.sdSchulCode){
    return { officeCode: SCHOOL.atptOfcdcScCode, schoolCode: SCHOOL.sdSchulCode };
  }
  try {
    const cached = JSON.parse(localStorage.getItem(LS_SCHOOL_CODE_KEY) || "null");
    if(cached && cached.schoolName === SCHOOL.name) return cached;
  } catch(e){}

  const candidates = await findSchoolByName(SCHOOL.name);
  if(!candidates.length) throw new Error(`NEIS에서 "${SCHOOL.name}" 학교를 찾지 못했습니다. SCHOOL 상수에 코드를 직접 입력해주세요.`);
  if(candidates.length > 1){
    console.warn("[neis] 학교명이 여러 건 검색되었습니다. 첫 번째 결과를 사용합니다:", candidates);
  }
  const picked = { ...candidates[0], schoolName: SCHOOL.name };
  try { localStorage.setItem(LS_SCHOOL_CODE_KEY, JSON.stringify(picked)); } catch(e){}
  return picked;
}

// =====================================================================
// 급식식단정보
// =====================================================================
function cleanMealMenu(text){
  if(!text) return [];
  return text.split("<br/>").map(s=>s.replace(/\([0-9.]+\)/g, "").trim()).filter(Boolean);
}

// 반환: [{ mealType: '조식'|'중식'|'석식', menu: string[], calInfo, ntrInfo }]
export async function getMeal(officeCode, schoolCode, date = new Date()){
  const { rows } = await callNeis("mealServiceDietInfo", {
    ATPT_OFCDC_SC_CODE: officeCode,
    SD_SCHUL_CODE: schoolCode,
    MLSV_YMD: ymd(date)
  });
  return rows.map(r=>({
    mealType: r.MMEAL_SC_NM,
    menu: cleanMealMenu(r.DDISH_NM),
    calInfo: r.CAL_INFO,
    ntrInfo: r.NTR_INFO
  }));
}

// =====================================================================
// 시간표 (고등학교 기준 — hisTimetable)
// =====================================================================
// 반환: [{ period: '1', subject: '상업경제', teacher }]
export async function getTimetable(officeCode, schoolCode, grade, classNum, date = new Date()){
  const { rows } = await callNeis("hisTimetable", {
    ATPT_OFCDC_SC_CODE: officeCode,
    SD_SCHUL_CODE: schoolCode,
    GRADE: grade,
    CLASS_NM: classNum,
    ALL_TI_YMD: ymd(date)
  });
  return rows
    .map(r=>({ period: r.PERIO, subject: r.ITRT_CNTNT, teacher: r.TCHR_NM || "" }))
    .sort((a,b)=>Number(a.period)-Number(b.period));
}

// =====================================================================
// 학사일정
// =====================================================================
// 반환: [{ date: 'YYYYMMDD', name, content, isHoliday }]
export async function getSchoolSchedule(officeCode, schoolCode, fromDate, toDate){
  const { rows } = await callNeis("SchoolSchedule", {
    ATPT_OFCDC_SC_CODE: officeCode,
    SD_SCHUL_CODE: schoolCode,
    AA_FROM_YMD: ymd(fromDate),
    AA_TO_YMD: ymd(toDate)
  });
  return rows.map(r=>({
    date: r.AA_YMD,
    name: r.EVENT_NM,
    content: r.EVENT_CNTNT || "",
    isHoliday: r.SBTR_DD_SC_NM === "휴업일"
  }));
}

// =====================================================================
// HUD 대기화면용 — 오늘 급식 + 오늘 시간표 + 다가오는 학사일정 한 번에
// =====================================================================
export async function getStandbyInfo(SCHOOL, grade, classNum){
  const { officeCode, schoolCode } = await resolveSchoolCodes(SCHOOL);
  const today = new Date();
  const in14days = new Date(today.getTime() + 14*24*60*60*1000);

  const [meal, timetable, schedule] = await Promise.allSettled([
    getMeal(officeCode, schoolCode, today),
    getTimetable(officeCode, schoolCode, grade, classNum, today),
    getSchoolSchedule(officeCode, schoolCode, today, in14days)
  ]);

  return {
    meal: meal.status === "fulfilled" ? meal.value : [],
    timetable: timetable.status === "fulfilled" ? timetable.value : [],
    schedule: schedule.status === "fulfilled" ? schedule.value.filter(e=>!e.isHoliday).slice(0,5) : [],
    errors: [meal, timetable, schedule].filter(r=>r.status==="rejected").map(r=>r.reason?.message)
  };
}
