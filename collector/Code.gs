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
 * 주의
 *  - 웹 앱 주소는 index.html 에 그대로 보이므로 누구나 보낼 수 있다. 그래서 아래에서 이벤트 이름과 값 길이를 걸러 낸다.
 *  - 시트가 수식으로 읽지 않도록 값 맨 앞의 = + - @ 는 지운다.
 *  - name(이름) 열은 참여 정보를 입력할 때 보내는 profile 행에서만 받는다. 이 시트는 이름이 들어 있으니 팀원에게만 공유한다.
 *  - 한 번에 받는 행은 최대 50개다.
 */
const 시트이름 = 'events';
const 열 = ['t', 'vid', 'sid', 'ev', 'dev', 'role', 'src', 'screen', 'act', 'target', 'intent', 'reward', 'withdraw', 'secs', 'form', 'tx', 'grade', 'gender', 'org', 'exp', 'name'];
const 허용이벤트 = ['page_view', 'ui_click', 'screen_time', 'form_submit', 'opinion_submit', 'opinion_cancel', 'question_submit', 'answer_submit', 'perk_answer', 'ad_view', 'session_time', 'profile'];
const 최대행 = 50;
const 최대길이 = 60;

function 안전값(v) {
  const s = v === undefined || v === null ? '' : String(v).slice(0, 최대길이);
  return s.replace(/^[=+\-@]+/, '');
}

function doPost(e) {
  try {
    const 본문 = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const 행들 = (Array.isArray(본문.rows) ? 본문.rows : [])
      .slice(0, 최대행)
      .filter(r => r && 허용이벤트.indexOf(r.ev) >= 0)
      .map(r => 열.map(k => 안전값(k === 'name' && r.ev !== 'profile' ? '' : r[k])));   // 이름은 참여 정보(profile) 행에서만 받는다
    if (행들.length) {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const 문서 = SpreadsheetApp.getActiveSpreadsheet();
        const 시트 = 문서.getSheetByName(시트이름) || 문서.insertSheet(시트이름);
        if (시트.getLastRow() === 0) 시트.appendRow(열);
        시트.getRange(시트.getLastRow() + 1, 1, 행들.length, 열.length).setValues(행들);
      } finally {
        lock.releaseLock();
      }
    }
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error');
  }
}

// 배포가 잘 됐는지 브라우저로 주소를 열어 볼 때 쓰는 확인용
function doGet() {
  return ContentService.createTextOutput('QFlowz collector ok');
}
