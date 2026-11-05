/**
 * QFlowz 이용 기록 수집기 (구글 시트 + Apps Script)
 *
 * 앱(index.html)이 보내는 이용 기록을 이 스크립트가 묶인 구글 시트의 'events' 탭에 한 줄씩 쌓는다.
 *
 * 설치
 *  1. 새 구글 시트를 만든다(예: QFlowz 이용 기록). 이 시트는 팀원에게만 공유한다.
 *  2. 확장 프로그램 > Apps Script 를 열고, 이 파일의 내용을 Code.gs 에 붙여 넣는다.
 *  3. 배포 > 새 배포 > 유형 '웹 앱'
 *       - 다음 사용자로 실행: 나
 *       - 액세스 권한이 있는 사용자: 모든 사용자
 *  4. 배포 뒤 나오는 웹 앱 주소(…/exec)를 index.html 의 CONFIG.collect.url 에 넣는다.
 *  5. 이 파일을 고쳐 다시 배포할 때는 '배포 관리 > 수정 > 새 버전'으로 올려야 주소가 그대로 유지된다.
 *  6. 열(column)을 바꾼 배포(예: name 열 추가)는 새 버전으로 올린 뒤 events 탭을 통째로 지워(제목 줄 포함) 제목 줄이 다시 만들어지게 한다.
 *     이미 쌓인 기록이 있다면 지우기 전에 다른 탭으로 복사해 둔다.
 *
 * 동시에 여러 명이 보낼 때
 *  - 시트에 쓰는 동안은 잠금을 걸어 한 번에 한 요청만 쓴다(한 번에 0.5초 남짓 걸려 초당 1.5건 안팎이 한계다).
 *  - 잠금을 풀기 전에 SpreadsheetApp.flush()로 시트에 확정한다. 이걸 빼면 다음 요청이 같은 줄에 덮어써 기록이 사라진다.
 *  - 차례를 30초까지 기다리고, 그래도 못 쓰면 'busy'를 돌려준다. 앱은 'ok'가 아니면 잠시 뒤 같은 묶음을 다시 보낸다.
 *  - 앱은 묶음마다 이름표(bid)를 붙인다. 이미 쓴 묶음이 다시 오면(응답만 못 받고 재시도한 경우) 6시간 동안은 다시 쓰지 않는다.
 *
 * 주의
 *  - 웹 앱 주소는 index.html 에 그대로 보이므로 누구나 보낼 수 있다. 그래서 아래에서 이벤트 이름과 값 길이를 걸러 낸다.
 *  - 시트가 수식으로 읽지 않도록 값 맨 앞의 = + - @ 는 지운다.
 *  - name(이름) 열은 참여 정보를 입력할 때 보내는 profile 행에서만 받는다. 이 시트는 이름이 들어 있으니 팀원에게만 공유한다.
 *  - 한 번에 받는 행은 최대 50개다.
 */
const 시트이름 = 'events';
const 열 = ['t', 'vid', 'sid', 'ev', 'dev', 'role', 'src', 'screen', 'act', 'target', 'intent', 'reward', 'withdraw', 'secs', 'form', 'tx', 'grade', 'gender', 'org', 'exp', 'name'];
const 허용이벤트 = ['page_view', 'ui_click', 'screen_time', 'form_submit', 'opinion_submit', 'opinion_cancel', 'question_submit', 'answer_submit', 'perk_answer', 'ad_view', 'ad_click', 'nudge_view', 'nudge_click', 'session_time', 'profile'];
const 최대행 = 50;
const 최대길이 = 60;
const 대기ms = 30000;
const 묶음기억초 = 21600;   // CacheService가 기억할 수 있는 최대 시간(6시간)

function 안전값(v) {
  const s = v === undefined || v === null ? '' : String(v).slice(0, 최대길이);
  return s.replace(/^[=+\-@]+/, '');
}

function 응답(s) { return ContentService.createTextOutput(s); }

function doPost(e) {
  try {
    const 본문 = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const 묶음 = typeof 본문.bid === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(본문.bid) ? 'b:' + 본문.bid : '';
    const 행들 = (Array.isArray(본문.rows) ? 본문.rows : [])
      .slice(0, 최대행)
      .filter(r => r && 허용이벤트.indexOf(r.ev) >= 0)
      .map(r => 열.map(k => 안전값(k === 'name' && r.ev !== 'profile' ? '' : r[k])));   // 이름은 참여 정보(profile) 행에서만 받는다
    if (!행들.length) return 응답('ok');
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(대기ms)) return 응답('busy');   // 앱이 잠시 뒤 다시 보낸다
    try {
      const 캐시 = CacheService.getScriptCache();
      if (묶음 && 캐시.get(묶음)) return 응답('ok');   // 이미 쓴 묶음(재시도)은 다시 쓰지 않는다
      const 문서 = SpreadsheetApp.getActiveSpreadsheet();
      const 시트 = 문서.getSheetByName(시트이름) || 문서.insertSheet(시트이름);
      if (시트.getLastRow() === 0) 시트.appendRow(열);
      시트.getRange(시트.getLastRow() + 1, 1, 행들.length, 열.length).setValues(행들);
      SpreadsheetApp.flush();   // 잠금을 풀기 전에 시트에 확정한다
      if (묶음) { try { 캐시.put(묶음, '1', 묶음기억초); } catch (err) {} }
    } finally {
      lock.releaseLock();
    }
    return 응답('ok');
  } catch (err) {
    return 응답('error');
  }
}

// 배포가 잘 됐는지 브라우저로 주소를 열어 볼 때 쓰는 확인용
function doGet() {
  return 응답('QFlowz collector ok');
}

// 시험 행(src 열이 claudetest 인 행)만 지운다. 웹 앱으로는 부를 수 없고, Apps Script 편집기에서 이 함수를 골라 '실행'으로 돌린다.
// 지운 행은 시트의 '파일 > 버전 기록'에서 되살릴 수 있다.
function clearTestRows() {
  const lock = LockService.getScriptLock();
  lock.waitLock(대기ms);
  try {
    const 시트 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(시트이름);
    const n = 시트 ? 시트.getLastRow() : 0;
    if (n < 2) return 0;
    const 값 = 시트.getRange(2, 열.indexOf('src') + 1, n - 1, 1).getValues();
    let 지움 = 0;
    // 아래에서 위로 올라가며, 이어진 시험 행은 한 번에 지운다
    for (let i = 값.length - 1; i >= 0;) {
      if (값[i][0] !== 'claudetest') { i--; continue; }
      let j = i;
      while (j > 0 && 값[j - 1][0] === 'claudetest') j--;
      시트.deleteRows(j + 2, i - j + 1);
      지움 += i - j + 1;
      i = j - 1;
    }
    SpreadsheetApp.flush();
    console.log('지운 시험 행: ' + 지움 + ' / 남은 행: ' + (시트.getLastRow() - 1));
    return 지움;
  } finally {
    lock.releaseLock();
  }
}
