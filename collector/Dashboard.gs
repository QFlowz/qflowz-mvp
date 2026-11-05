/**
 * QFlowz 대시보드 (구글 시트 1면)
 *
 * 'events' 탭에 쌓인 이용 기록을 읽어, 측정하려는 값(KPI)을 한 장에 보여 주는 '대시보드' 탭을 맨 앞에 만든다.
 * 숫자는 모두 수식이라 기록이 쌓이면 시트를 열 때마다 저절로 바뀐다. 이 스크립트는 탭을 만들 때 한 번만 돌리면 된다.
 *
 * 설치
 *  1. 수집기(Code.gs)를 붙여 둔 같은 Apps Script 프로젝트에서 파일 추가(+) > 스크립트로 'Dashboard' 를 만들고 이 내용을 붙여 넣는다.
 *  2. 저장한 뒤 함수 '대시보드만들기' 를 한 번 실행한다(처음에는 권한 허용 창이 뜬다). 구글 시트를 새로 열면 위쪽에 'QFlowz' 메뉴도 생긴다.
 *  3. 수집기 웹 앱은 다시 배포하지 않아도 된다. 이 파일은 시트 안에서 실행될 뿐 웹 앱 주소와 상관이 없다.
 *  4. 다시 실행하면 대시보드 탭을 새로 만든다. 노란 입력 칸에 직접 쓴 값은 이름표가 같으면 그대로 옮겨 온다.
 *
 * 만들어지는 탭
 *  - 대시보드: 보는 화면. 맨 앞에 놓인다.
 *  - _data: 계산용(숨김). events 탭에서 시험용 src 행을 뺀 사본이고 이름 열은 가져오지 않는다.
 *
 * 주의
 *  - events 탭의 열 순서가 바뀌면(Code.gs 의 열 배열) 아래 기대열도 같이 고친다. 어긋나면 대시보드의 '데이터 점검'에 경고가 뜬다.
 *  - 아직 실제 시트에서 돌려 보지 않은 수식이다. 처음에는 events 에서 몇 줄을 손으로 세어 대시보드 숫자와 맞는지 본다.
 */
const 대시보드이름 = '대시보드';
const 계산이름 = '_data';
const 기록이름 = 'events';
const 기대열 = ['t', 'vid', 'sid', 'ev', 'dev', 'role', 'src', 'screen', 'act', 'target', 'intent', 'reward', 'withdraw', 'secs', 'form', 'tx', 'grade', 'gender', 'org', 'exp', 'name'];

const 주색 = '#C3002F';     // 앱의 강조색
const 연한색 = '#F3E6E9';
const 입력배경 = '#FFF8E1';
const 입력글자 = '#1A56DB';
const 회색 = '#6B7280';
const 선색 = '#E3E6EC';
const 열수 = 10;            // A~J

// 입력 칸의 이름표. 대시보드를 다시 만들 때 같은 이름표의 값을 그대로 옮겨 온다. 값은 모두 C열에 둔다
const 설정이름 = { 제외: '제외할 src (시험용)', GA: 'GA4 사용자 수 (직접 입력)', 최소: '비교에 필요한 최소 표본(n)' };

/* ---------- 수식 만드는 도구 ---------- */
// _data 탭의 열을 2행부터 끝까지 가리킨다. 이름(name) 열은 가져오지 않는다
const 열범위 = {};
기대열.slice(0, 20).forEach((k, i) => {
  const L = String.fromCharCode(65 + i);
  열범위[k] = `'${계산이름}'!$${L}$2:$${L}`;
});
const 세션체류범위 = `'${계산이름}'!$X$2:$X`;   // _data 의 W:X 에 방문(sid)별 최대 체류 초를 펼쳐 둔다

const 같다 = (k, v) => `${열범위[k]}="${v}"`;
const 조건들 = (조건) => 조건.map(c => ', ' + c).join('');
// 서로 다른 값의 수(예: 서로 다른 방문자 코드)
const 고유 = (k, ...조건) => `IFERROR(COUNTUNIQUE(FILTER(${열범위[k]}, ${열범위[k]}<>""${조건들(조건)})), 0)`;
// 행 수
const 개수 = (...쌍) => `COUNTIFS(${쌍.map(([k, v]) => `${열범위[k]}, "${v}"`).join(', ')})`;
const 수치들 = (k, ...조건) => `FILTER(${열범위[k]}, ${열범위[k]}<>""${조건들(조건)})`;
const 중앙값 = (k, ...조건) => `IFERROR(MEDIAN(${수치들(k, ...조건)}), "")`;
const 표본수 = (k, ...조건) => `IFERROR(COUNT(${수치들(k, ...조건)}), 0)`;
const 비 = (분자, 분모) => `IFERROR(${분자}/${분모}, "")`;
// 배너 클릭 수. 2026-11-06부터는 ad_click 으로, 그 전에는 ui_click(act=ad)으로 남았다. 한 클릭은 둘 중 하나로만 남으므로 더한다
const 배너클릭 = (키) => 키
  ? `(${개수(['ev', 'ad_click'], ['target', 키])}+${개수(['ev', 'ui_click'], ['act', 'ad'], ['target', 키])})`
  : `(${개수(['ev', 'ad_click'])}+${개수(['ev', 'ui_click'], ['act', 'ad'])})`;
// 혜택 탭 질문 응답 수. 대상에 'food-*' 처럼 *를 쓸 수 있다
const 응답 = (대상, 값) => `COUNTIFS(${열범위.ev}, "perk_answer", ${열범위.target}, "${대상}"${값 ? `, ${열범위.intent}, "${값}"` : ''})`;

/* ---------- 모델 가정 vs 실측 표의 행 ---------- */
// 가정: 모델(v51)의 값. 비워 두면 비교는 하지 않는다. 값은 노란 칸에서 직접 고칠 수 있다
const 비교행 = [
  { 라벨: '부원 1명당 방문 수 (회)', 가정: 2, 서식: '0.0',
    실측: 비(고유('sid', 같다('role', 'member')), 고유('vid', 같다('role', 'member'))), n: 고유('vid', 같다('role', 'member')),
    주의: '부원 역할로 들어온 방문자 기준. 관찰 기간 그대로라 월 환산은 아님' },
  { 라벨: '총무 1명당 방문 수 (회)', 가정: 12, 서식: '0.0',
    실측: 비(고유('sid', 같다('role', 'treasurer')), 고유('vid', 같다('role', 'treasurer'))), n: 고유('vid', 같다('role', 'treasurer')),
    주의: '총무 역할로 들어온 방문자 기준. 기간이 한 달보다 짧으면 크게 낮게 나옴' },
  { 라벨: '방문당 광고 노출 (회)', 가정: 1.5, 서식: '0.00',
    실측: 비(개수(['ev', 'ad_view']), 고유('sid')), n: 고유('sid'),
    주의: '배너 4장이 돌아 한 화면에서 최대 4번까지 센다. 가정과 그대로 비교하기 어려움' },
  { 라벨: '광고 클릭률', 가정: 0.003, 서식: '0.0%',
    실측: 비(배너클릭(), 개수(['ev', 'ad_view'])), n: `${개수(['ev', 'ad_view'])}`,
    주의: '"예시 광고"라고 알린 배너의 클릭률. 배너끼리 비교에만 쓰기' },
  { 라벨: '설문 소요 시간 중앙값 (분)', 가정: 10, 서식: '0.0',
    실측: `IFERROR(MEDIAN(${수치들('secs', 같다('form', 'survey:done'))})/60, "")`, n: 표본수('secs', 같다('form', 'survey:done')),
    주의: '샘플 설문은 15문항 약 5분짜리라 실제 일감의 10분과 다름' },
  { 라벨: '설문 일감 쓸 의향 (yes 비율)', 가정: 0.5, 서식: '0%',
    실측: 비(응답('job-survey', 'yes'), 응답('job-survey')), n: 응답('job-survey'),
    주의: '말로 한 의향이라 실제 가입률보다 높게 나오기 쉬움' },
  { 라벨: '최소 인출 금액 중앙값 (원)', 가정: 5000, 서식: '#,##0',
    실측: 중앙값('withdraw', 같다('ev', 'perk_answer'), `LEFT(${열범위.target}, 4)="job-"`), n: 표본수('withdraw', 같다('ev', 'perk_answer'), `LEFT(${열범위.target}, 4)="job-"`),
    주의: '첫 일감 답변에서 한 번만 묻는다' },
  { 라벨: '푸드패스 쿠폰 쓸 의향 (yes 비율)', 가정: '', 서식: '0%',
    실측: 비(응답('food-*', 'yes'), 응답('food-*')), n: 응답('food-*'),
    주의: '모델의 쿠폰 사용률 1%는 실제 사용 기준이라 의향과 직접 비교하지 않음' },
  { 라벨: '푸드패스 최소 할인율 중앙값 (%)', 가정: '', 서식: '0"%"',
    실측: 중앙값('reward', 같다('ev', 'perk_answer'), `LEFT(${열범위.target}, 5)="food-"`), n: 표본수('reward', 같다('ev', 'perk_answer'), `LEFT(${열범위.target}, 5)="food-"`),
    주의: '단체로 가 볼 만한 최소 할인율' },
  { 라벨: '제휴 결제 비중 중앙값 (%)', 가정: 20, 서식: '0"%"',
    실측: 중앙값('reward', 같다('ev', 'perk_answer'), 같다('target', 'tr-pay')), n: 표본수('reward', 같다('ev', 'perk_answer'), 같다('target', 'tr-pay')),
    주의: '연 지출 중 앱으로 바로 결제할 비중. 총무 답변만 들어옴' },
  { 라벨: '이동 행사 인원 중앙값 (명)', 가정: 18, 서식: '0',
    실측: 중앙값('reward', 같다('ev', 'perk_answer'), 같다('target', 'tr-insurance')), n: 표본수('reward', 같다('ev', 'perk_answer'), 같다('target', 'tr-insurance')),
    주의: '여행자보험 질문의 첫째 답' },
  { 라벨: '이동 행사 연 횟수 중앙값 (회)', 가정: 2, 서식: '0.0',
    실측: 중앙값('withdraw', 같다('ev', 'perk_answer'), 같다('target', 'tr-insurance')), n: 표본수('withdraw', 같다('ev', 'perk_answer'), 같다('target', 'tr-insurance')),
    주의: '여행자보험 질문의 둘째 답(withdraw 열에 들어감)' },
  { 라벨: '통계 활용 동의 (yes 비율)', 가정: 0.7, 서식: '0%',
    실측: 비(응답('tr-data', 'yes'), 응답('tr-data')), n: 응답('tr-data'),
    주의: '보고서에는 조건부(maybe)를 따로 적는다' },
  { 라벨: '통계 활용 조건부 동의 (maybe 비율)', 가정: '', 서식: '0%',
    실측: 비(응답('tr-data', 'maybe'), 응답('tr-data')), n: 응답('tr-data'),
    주의: '"조건을 보고 정할게요"를 고른 비율' }
];

// 혜택 탭 질문 항목. 중앙값은 reward(고른 최소 희망 값)다
const 혜택항목 = [
  ['설문 일감 (샘플 설문)', 'job-survey', '#,##0"원"', '1건 최소 보상'],
  ['사용성 테스트', 'job-ut', '#,##0"원"', '15~20분 1건 최소 보상'],
  ['사진·음성 촬영', 'job-photo', '#,##0"원"', '3분 1건 최소 보상'],
  ['AI 답변 평가', 'job-eval', '#,##0"원"', '1시간 최소 시급'],
  ['푸드패스 · 한식당', 'food-hansik', '0"%"', '단체로 갈 최소 할인율'],
  ['푸드패스 · 치킨집', 'food-chicken', '0"%"', '단체로 갈 최소 할인율'],
  ['푸드패스 · 분식', 'food-snack', '0"%"', '단체로 갈 최소 할인율'],
  ['총무 · 여행자보험', 'tr-insurance', '0"명"', '이동 행사 인원'],
  ['총무 · 앱 결제', 'tr-pay', '0"%"', '연 지출 중 앱 결제 비중'],
  ['총무 · 통계 익명 활용', 'tr-data', 'General', '동의 여부만 묻는 항목']
];

const 설문구간 = [['A', '기본 정보·흡연 경험'], ['B', '금연제품 인지도·이용'], ['C', '구매·이용 장애요인'], ['D', '새 금연제품 선호도'], ['E', '마케팅·정책 수요']];
const 배너 = [['kb-insurance', 'KB손해보험'], ['oliveyoung-sale', '올리브영 세일'], ['baemin-isaac-toast', '배민 이삭토스트'], ['spotify-afterparty', '스포티파이']];
const 표본구성 = [
  ['학년', 'grade', [['g1', '1학년'], ['g2', '2학년'], ['g3', '3학년'], ['g4', '4학년 이상']]],
  ['성별', 'gender', [['m', '남성'], ['f', '여성']]],
  ['동아리 소속', 'org', [['central', '중앙동아리'], ['other', '기타 동아리·소모임'], ['dept', '학과 학회·학생회'], ['none', '소속 없음']]],
  ['총무 경험', 'exp', [['yes', '있음'], ['no', '없음']]],
  ['기기', 'dev', [['m', '휴대폰(폭 720px 미만)'], ['d', '컴퓨터·태블릿']]]
];
const 잴수없음 = [
  '가입 전환: 앱은 참여 정보를 입력하기 전에는 시트로 아무것도 보내지 않아요. 시트에는 입력을 마친 사람만 들어오니, 입력 창에서 나간 사람은 GA4에만 남아요. 그래서 위의 "GA4 사용자 수"를 직접 적어야 전환이 나와요.',
  '학기 유지율 70%: 한 학기가 지나야 알 수 있어요. 지금은 첫 주와 마지막 주에 다시 온 방문자 비율 정도만 대신 볼 수 있어요.',
  '월 응답 10%, 월 활성 부원 52%: 매달 반복한 응답과 동아리 부원 수(앱 밖 정보)가 필요해서 한 번 하는 테스트로는 나오지 않아요.',
  '실제 결제·쿠폰 사용·광고 매출: 목업이라 말한 의향만 있어요. 의향은 실제보다 높게 나오니 모델에 넣을 때는 보수적으로 깎아 쓰고 근거를 적어요.',
  '고객 획득 단계별 전환(CAC): 광고 집행 전이라 비어 있어요. 유입 경로(src)별 방문까지만 볼 수 있어요.'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('QFlowz').addItem('대시보드 새로 만들기', '대시보드만들기').addToUi();
}

/* ---------- 대시보드 만들기 ---------- */
function 대시보드만들기() {
  const 문서 = SpreadsheetApp.getActiveSpreadsheet();

  // events 탭이 아직 없으면 제목 줄만 있는 탭을 만든다(첫 기록이 오기 전에도 대시보드를 열어 볼 수 있게)
  let 기록 = 문서.getSheetByName(기록이름);
  if (!기록) { 기록 = 문서.insertSheet(기록이름); 기록.appendRow(기대열); }

  const 입력라벨 = [설정이름.제외, 설정이름.GA, 설정이름.최소].concat(비교행.map(x => x.라벨));
  const 옛 = 문서.getSheetByName(대시보드이름);
  const 이전 = 이전입력(옛, 입력라벨);
  if (옛) 문서.deleteSheet(옛);   // 다시 만들 때 합친 칸과 차트가 남지 않게 통째로 지운다

  const 시트 = 문서.insertSheet(대시보드이름, 0);
  계산탭만들기(문서, 기록);
  const 값 = (라벨, 기본) => Object.prototype.hasOwnProperty.call(이전, 라벨) ? 이전[라벨] : 기본;

  /* --- 칸 쌓기 --- */
  const 격자 = [], 서식 = [], 병합 = [], 구역행 = [], 머리행 = [], 입력칸 = [], 작은글 = [], 줄바꿈 = [];
  const 놓기 = (r, c, v, f) => {
    (격자[r] = 격자[r] || [])[c - 1] = v;
    if (f) (서식[r] = 서식[r] || [])[c - 1] = f;
  };
  const 합치기 = (r, c, 가로, 세로) => 병합.push([r, c, 세로 || 1, 가로]);
  const 구역 = (r, 제목) => { 놓기(r, 2, 제목); 구역행.push(r); };
  const 머리 = (r, 제목들, 끝열) => { 제목들.forEach((t, i) => 놓기(r, 2 + i, t)); 머리행.push([r, 끝열 || 열수]); };

  // 맨 위: 제목과 입력 칸
  놓기(1, 2, 'QFlowz 실측 대시보드'); 합치기(1, 2, 9);
  놓기(2, 2, 'events 탭의 기록으로 자동 계산돼요. 노란 칸은 직접 고칠 수 있는 입력값이에요. 숫자가 작을 때는 비율이 크게 흔들리니 표본(n)을 같이 보세요.'); 합치기(2, 2, 9);
  놓기(4, 2, 설정이름.제외); 놓기(4, 3, 값(설정이름.제외, 'claudetest')); 합치기(4, 3, 2); 입력칸.push([4, 3, 2]);
  놓기(5, 2, 설정이름.GA); 놓기(5, 3, 값(설정이름.GA, '')); 합치기(5, 3, 2); 입력칸.push([5, 3, 2]);
  놓기(6, 2, 설정이름.최소); 놓기(6, 3, 값(설정이름.최소, 10), '0'); 합치기(6, 3, 2); 입력칸.push([6, 3, 2]);

  // 표들은 아래에서부터 쌓고, 한눈에 보기 카드는 마지막에 참조를 모아 채운다
  let r = 35;
  const 참조 = {};

  // 1) 모델 가정 vs 실측
  구역(r++, '단위경제 입력값 — 모델 가정과 실측 비교');
  머리(r, ['지표', '모델 가정', '실측', '표본(n)', '비교', '읽을 때 주의']); 합치기(r, 7, 4); r++;
  const 비교시작 = r;
  비교행.forEach(x => {
    놓기(r, 2, x.라벨);
    놓기(r, 3, 값(x.라벨, x.가정), x.서식); 입력칸.push([r, 3, 1]);
    놓기(r, 4, '=' + x.실측, x.서식);
    놓기(r, 5, '=' + x.n, '#,##0');
    놓기(r, 6, `=IF(NOT(AND(ISNUMBER(C${r}), ISNUMBER(D${r}))), "", IF(E${r}<$C$6, "표본 적음", IF(C${r}=0, "", IF(ABS(D${r}/C${r}-1)<=0.1, "비슷", IF(D${r}>C${r}, "높음 ▲", "낮음 ▼")))))`);
    놓기(r, 7, x.주의); 합치기(r, 7, 4); 작은글.push([r, 7, 4]);
    참조[x.라벨] = r;
    r++;
  });
  const 비교끝 = r - 1;
  놓기(r, 2, '비교: 실측이 가정의 ±10% 안이면 "비슷", 표본(n)이 위의 최소 표본보다 작으면 "표본 적음"으로 둡니다. 가정 칸이 비어 있으면 비교하지 않아요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  r += 2;

  // 2) 혜택 탭 질문 응답
  구역(r++, '혜택 탭 질문 응답 — 항목별');
  머리(r++, ['항목', '응답 수', '쓸 의향', '조건부', '안 씀', '쓸 의향 비율', '희망 값 중앙값', '무엇을 물었나']);
  const 혜택시작 = r;
  혜택항목.forEach(([이름, 키, 서식값, 뜻]) => {
    놓기(r, 2, 이름);
    놓기(r, 3, '=' + 응답(키), '#,##0');
    놓기(r, 4, '=' + 응답(키, 'yes'), '#,##0');
    놓기(r, 5, '=' + 응답(키, 'maybe'), '#,##0');
    놓기(r, 6, '=' + 응답(키, 'no'), '#,##0');
    놓기(r, 7, `=IFERROR(D${r}/C${r}, "")`, '0%');
    놓기(r, 8, 키 === 'tr-data' ? '' : '=' + 중앙값('reward', 같다('ev', 'perk_answer'), 같다('target', 키)), 서식값);
    놓기(r, 9, 뜻);
    r++;
  });
  const 혜택끝 = r - 1;
  놓기(r, 2, '한 사람이 같은 항목에 한 번만 답할 수 있어요(같은 브라우저 기준). 말로 한 의향이라 실제 사용보다 높게 나오기 쉬워요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  r += 2;

  // 3) 샘플 설문 단계
  구역(r++, '샘플 설문 — 단계별 도달 인원');
  머리(r++, ['단계', '도달(명)', '여기서 닫음', '직전 단계 대비', '처음 대비']);
  const 설문시작 = r, 설문A = r, 설문완료 = r + 설문구간.length, 설문탈락 = r + 설문구간.length + 1;
  설문구간.forEach(([id, 이름], i) => {
    놓기(r, 2, `${id} ${이름}`);
    놓기(r, 3, '=' + 고유('vid', 같다('form', 'survey:' + id)), '#,##0');
    놓기(r, 4, '=' + 고유('vid', 같다('form', 'survey:quit-' + id)), '#,##0');
    if (i === 0) { 놓기(r, 5, '-'); 놓기(r, 6, '-'); }
    else {
      const 앞 = i === 1 ? `(C${설문A}-C${설문탈락})` : `C${r - 1}`;
      놓기(r, 5, `=IFERROR(C${r}/${앞}, "")`, '0%');
      놓기(r, 6, `=IFERROR(C${r}/(C${설문A}-C${설문탈락}), "")`, '0%');
    }
    r++;
  });
  놓기(r, 2, '완료'); 놓기(r, 3, '=' + 고유('vid', 같다('form', 'survey:done')), '#,##0'); 놓기(r, 4, '-');
  놓기(r, 5, `=IFERROR(C${r}/C${r - 1}, "")`, '0%'); 놓기(r, 6, `=IFERROR(C${r}/(C${설문A}-C${설문탈락}), "")`, '0%');
  const 설문끝 = r; r++;
  놓기(r, 2, '대상 아님 (1번 문항에서 탈락)'); 놓기(r, 3, '=' + 고유('vid', 같다('form', 'survey:out')), '#,##0'); 놓기(r, 4, '-');
  r++;
  놓기(r, 2, 'B 단계의 "직전 단계 대비"와 모든 "처음 대비"는 대상 아님을 뺀 인원을 기준으로 해요. 같은 사람이 여러 번 열어도 한 명으로 세요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  참조.시작 = `C${설문A}`; 참조.완료 = `C${설문완료}`; 참조.탈락 = `C${설문탈락}`;
  r += 2;

  // 4) 광고 배너
  구역(r++, '광고 배너별');
  머리(r++, ['배너', '노출', '클릭', '클릭률']);
  const 배너시작 = r;
  배너.forEach(([키, 이름]) => {
    놓기(r, 2, `${이름} (${키})`);
    놓기(r, 3, '=' + 개수(['ev', 'ad_view'], ['target', 키]), '#,##0');
    놓기(r, 4, '=' + 배너클릭(키), '#,##0');
    놓기(r, 5, `=IFERROR(D${r}/C${r}, "")`, '0.0%');
    r++;
  });
  const 배너끝 = r - 1;
  놓기(r, 2, '합계'); 놓기(r, 3, `=SUM(C${배너시작}:C${배너끝})`, '#,##0'); 놓기(r, 4, `=SUM(D${배너시작}:D${배너끝})`, '#,##0'); 놓기(r, 5, `=IFERROR(D${r}/C${r}, "")`, '0.0%');
  참조.노출 = `C${r}`; 참조.클릭 = `D${r}`;
  r++;
  놓기(r, 2, '배너에는 "광고 자리 예시 · 실제 광고 아님"이 붙어 있어요. 이 클릭률은 실제 광고의 클릭률이 아니라 예시라고 알려 줬는데도 누른 비율이에요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  r += 2;

  // 5) 유입 경로(src)별
  구역(r++, '유입 경로(src)별');
  머리(r++, ['src', '참여자', '방문', '설문 완료', '혜택 질문 응답자']);
  const 경로시작 = r;
  for (let k = 0; k < 8; k++) {
    if (k === 0) {
      const 없음 = `${열범위.src}=""`;
      놓기(r, 2, '(src 없음)');
      놓기(r, 3, '=' + 고유('vid', 없음), '#,##0'); 놓기(r, 4, '=' + 고유('sid', 없음), '#,##0');
      놓기(r, 5, '=' + 고유('vid', 같다('form', 'survey:done'), 없음), '#,##0'); 놓기(r, 6, '=' + 고유('vid', 같다('ev', 'perk_answer'), 없음), '#,##0');
    } else {
      const 같은 = `${열범위.src}=$B${r}`;
      놓기(r, 2, `=IFERROR(INDEX(SORT(UNIQUE(FILTER(${열범위.src}, ${열범위.src}<>""))), ${k}), "")`);
      놓기(r, 3, `=IF($B${r}="", "", ${고유('vid', 같은)})`, '#,##0'); 놓기(r, 4, `=IF($B${r}="", "", ${고유('sid', 같은)})`, '#,##0');
      놓기(r, 5, `=IF($B${r}="", "", ${고유('vid', 같다('form', 'survey:done'), 같은)})`, '#,##0'); 놓기(r, 6, `=IF($B${r}="", "", ${고유('vid', 같다('ev', 'perk_answer'), 같은)})`, '#,##0');
    }
    r++;
  }
  놓기(r, 2, '주소 끝에 ?src=이름 을 붙여 나눠 준 경로가 가나다순으로 최대 7개까지 나와요. 시험용 src는 위의 "제외할 src"로 빠져요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  r += 2;

  // 6) 표본 구성
  구역(r++, '표본 구성 — 누가 썼나');
  머리(r++, ['구분', '명', '비율']);
  const 전체행 = r;
  놓기(r, 2, '참여 정보를 입력한 사람 (전체)'); 놓기(r, 3, '=' + 고유('vid', 같다('ev', 'profile')), '#,##0'); 놓기(r, 4, `=IF(C${r}>0, 1, "")`, '0%');
  참조.참여자 = `C${r}`;
  r++;
  표본구성.forEach(([묶음, 키, 보기들]) => {
    보기들.forEach(([코드, 이름]) => {
      놓기(r, 2, `${묶음} · ${이름}`);
      const 조건 = 키 === 'dev' ? [같다('dev', 코드)] : [같다('ev', 'profile'), 같다(키, 코드)];
      놓기(r, 3, '=' + 고유('vid', ...조건), '#,##0');
      놓기(r, 4, `=IFERROR(C${r}/$C$${전체행}, "")`, '0%');
      r++;
    });
  });
  const 구성끝 = r - 1;
  놓기(r, 2, '정보를 고쳐 다시 입력한 사람은 고치기 전 값과 고친 뒤 값에 모두 세어질 수 있어요. 기기는 방문자 코드 기준이라 폰·노트북을 둘 다 쓴 사람은 양쪽에 들어가요.'); 합치기(r, 2, 9); 작은글.push([r, 2, 9]);
  r += 2;

  // 7) 이 테스트로는 잴 수 없는 것
  구역(r++, '이 테스트로는 잴 수 없는 것');
  잴수없음.forEach(글 => { 놓기(r, 2, '• ' + 글); 합치기(r, 2, 9); 줄바꿈.push(r); r++; });
  r += 1;

  // 8) 데이터 점검
  구역(r++, '데이터 점검');
  const 점검 = {};
  const 점검행 = (키, 라벨, 식, 서식값) => { 놓기(r, 2, 라벨); 놓기(r, 3, '=' + 식, 서식값); 합치기(r, 3, 8); 점검[키] = r; r++; };
  점검행('기록', '기록 행 수 (events 탭)', `COUNTIF('${기록이름}'!$D$2:$D, "?*")`, '#,##0');
  점검행('계산', '계산에 쓴 행 수 (시험용 src 제외)', `COUNTIF(${열범위.ev}, "?*")`, '#,##0');
  점검행('제외', '제외한 행 수', `C${점검.기록}-C${점검.계산}`, '#,##0');
  점검행('열', '열 순서', `IF(JOIN(",", '${기록이름}'!$A$1:$U$1)="${기대열.join(',')}", "정상", "⚠ events 탭의 열 순서가 Dashboard.gs 의 기대열과 달라요")`);
  const 글자수 = k => `SUMPRODUCT(ISTEXT(${열범위[k]})*(${열범위[k]}<>""))`;
  점검행('숫자', '숫자 열 형식 (reward·withdraw·secs)', `IF(${글자수('reward')}+${글자수('withdraw')}+${글자수('secs')}=0, "정상", "⚠ 숫자가 글자로 들어간 칸이 있어요. 중앙값이 비어 보일 수 있어요")`);
  점검행('마지막', '마지막 기록 시각 (t 열)', `IFERROR(ARRAYFORMULA(LOOKUP(2, 1/(${열범위.ev}<>""), ${열범위.t})), "기록 없음")`);
  r += 1;

  // 9) 화면별 머문 시간 (결과가 아래로 늘어나므로 맨 끝에 둔다)
  구역(r++, '화면별 머문 시간 (screen_time)');
  놓기(r, 2, `=IFERROR(QUERY('${계산이름}'!$A$1:$T, "select H, count(N), avg(N), sum(N) where D='screen_time' group by H order by sum(N) desc label H '화면', count(N) '기록 수', avg(N) '평균(초)', sum(N) '합계(초)'", 1), "기록 없음")`);
  const 화면표 = r;
  머리행.push([r, 5]);
  r += 1;
  for (let i = 0; i < 24; i++) { 놓기(r + i, 3, '', '#,##0'); 놓기(r + i, 4, '', '0.0'); 놓기(r + i, 5, '', '#,##0'); }
  놓기(r + 24, 2, '화면 이름은 역할/탭이에요(m=부원, t=총무. ledger=거래 내역, evidence=결제 근거, perks=혜택 등). 한 번에 최대 30분까지만 인정하고 탭이 가려진 시간은 빠져요.'); 합치기(r + 24, 2, 9); 작은글.push([r + 24, 2, 9]);
  const 마지막행 = r + 24;

  // 위 입력 칸 오른쪽의 상태 줄
  놓기(4, 5, '계산에 쓴 기록 행'); 합치기(4, 5, 2); 놓기(4, 7, `=C${점검.계산}`, '#,##0'); 합치기(4, 7, 4);
  놓기(5, 5, '마지막 기록'); 합치기(5, 5, 2); 놓기(5, 7, `=C${점검.마지막}`); 합치기(5, 7, 4);
  놓기(6, 5, '데이터 점검'); 합치기(6, 5, 2); 놓기(6, 7, `=IF(AND(C${점검.열}="정상", C${점검.숫자}="정상"), "정상", "⚠ 아래 '데이터 점검'을 확인하세요")`); 합치기(6, 7, 4);

  /* --- 한눈에 보기 카드 --- */
  구역(8, '한눈에 보기');
  구역(17, '차트');
  const 세션수 = 고유('sid');
  const 가정광고 = 참조['방문당 광고 노출 (회)'];
  const 카드 = [
    // [블록, 자리, 제목, 값, 서식, 보조]
    [0, 0, '참여자 수', '=' + 고유('vid'), '#,##0', '고유 방문자 코드(vid) 기준'],
    [0, 1, '방문 수', '=' + 세션수, '#,##0', `=IFERROR("참여자 1명당 "&TEXT(${세션수}/${고유('vid')}, "0.0")&"회", "")`],
    [0, 2, '방문 1회 체류 (중앙값)', `=IFERROR(MEDIAN(${세션체류범위})/60, "")`, '0.0"분"', `="방문 "&COUNT(${세션체류범위})&"회 기준"`],
    [0, 3, '휴대폰 비중', '=' + 비(고유('vid', 같다('dev', 'm')), 고유('vid')), '0%', '폭 720px 미만 화면'],
    [0, 4, '혜택 질문 응답자', '=' + 고유('vid', 같다('ev', 'perk_answer')), '#,##0', `=IFERROR("참여자의 "&TEXT(${고유('vid', 같다('ev', 'perk_answer'))}/${고유('vid')}, "0%"), "")`],
    [1, 0, '샘플 설문 완료율', `=IFERROR(${참조.완료}/(${참조.시작}-${참조.탈락}), "")`, '0%', `="완료 "&${참조.완료}&" / 대상 "&(${참조.시작}-${참조.탈락})&"명"`],
    [1, 1, '방문당 광고 노출', `=D${가정광고}`, '0.00"회"', `=IF(ISNUMBER(C${가정광고}), "모델 가정 "&TEXT(C${가정광고}, "0.0")&"회", "")`],
    [1, 2, '배너 클릭률', `=IFERROR(${참조.클릭}/${참조.노출}, "")`, '0.0%', `="클릭 "&${참조.클릭}&" / 노출 "&${참조.노출}`],
    [1, 3, '일감 쓸 의향 (yes)', '=' + 비(응답('job-*', 'yes'), 응답('job-*')), '0%', `="yes "&${응답('job-*', 'yes')}&" / 응답 "&${응답('job-*')}`],
    [1, 4, '참여 정보 입력 전환', `=IF(AND(ISNUMBER($C$5), $C$5>0), ${참조.참여자}/$C$5, "GA4 수 입력")`, '0%', `=IF(AND(ISNUMBER($C$5), $C$5>0), "입력 "&${참조.참여자}&"명 / GA4 "&$C$5&"명", "위 노란 칸에 GA4 사용자 수를 적어요")`]
  ];
  const 카드열 = [2, 3, 5, 7, 9], 카드폭 = [1, 2, 2, 2, 1];
  const 카드칸 = [];
  카드.forEach(([블록, 자리, 제목, 값식, 서식값, 보조]) => {
    const 위 = 9 + 블록 * 4, c = 카드열[자리], w = 카드폭[자리];
    놓기(위, c, 제목); 놓기(위 + 1, c, 값식, 서식값); 놓기(위 + 2, c, 보조);
    if (w > 1) { 합치기(위, c, w); 합치기(위 + 1, c, w); 합치기(위 + 2, c, w); }
    카드칸.push([위, c, w]);
  });

  /* --- 시트에 쓰기 --- */
  const 행수 = Math.max(격자.length - 1, 마지막행);
  const 값표 = [], 서식별 = {};
  for (let i = 1; i <= 행수; i++) {
    const a = [];
    for (let j = 0; j < 열수; j++) {
      const v = (격자[i] || [])[j];
      a.push(v === undefined ? '' : v);
      const f = (서식[i] || [])[j];
      if (f && f !== 'General') (서식별[f] = 서식별[f] || []).push(String.fromCharCode(65 + j) + i);
    }
    값표.push(a);
  }
  if (시트.getMaxRows() < 행수) 시트.insertRowsAfter(시트.getMaxRows(), 행수 - 시트.getMaxRows());
  if (시트.getMaxColumns() > 열수) 시트.deleteColumns(열수 + 1, 시트.getMaxColumns() - 열수);
  // 서식이 같은 칸끼리 묶어 한 번에 정한 뒤 값을 쓴다
  Object.keys(서식별).forEach(f => 시트.getRangeList(서식별[f]).setNumberFormat(f));
  시트.getRange(1, 1, 행수, 열수).setValues(값표);

  /* --- 모양 --- */
  시트.setHiddenGridlines(true);
  [14, 200, 100, 100, 100, 100, 100, 100, 200, 280].forEach((w, i) => 시트.setColumnWidth(i + 1, w));
  시트.getRange(1, 1, 행수, 열수).setFontSize(10).setVerticalAlignment('middle');
  시트.setRowHeight(1, 40); 시트.setRowHeight(2, 26);
  시트.getRange(1, 2, 1, 9).setBackground(주색).setFontColor('#FFFFFF').setFontSize(16).setFontWeight('bold');
  시트.getRange(2, 2).setFontColor(회색).setFontSize(9);
  시트.getRange(4, 2, 3, 1).setFontWeight('bold');
  시트.getRange(4, 5, 3, 2).setFontColor(회색).setHorizontalAlignment('right');
  시트.getRange(4, 7, 3, 4).setHorizontalAlignment('left');

  구역행.forEach(rr => {
    시트.getRange(rr, 2, 1, 9).setBackground(연한색).setFontColor(주색).setFontWeight('bold').setFontSize(11);
    시트.setRowHeight(rr, 26);
  });
  머리행.forEach(([rr, 끝]) => 시트.getRange(rr, 2, 1, 끝 - 1).setFontWeight('bold').setBorder(null, null, true, null, null, null, 주색, SpreadsheetApp.BorderStyle.SOLID).setHorizontalAlignment('center'));
  머리행.forEach(([rr]) => 시트.getRange(rr, 2).setHorizontalAlignment('left'));

  // 표 안쪽: 숫자는 가운데 정렬, 아래 줄 구분선
  const 표범위 = [[비교시작, 비교끝, 3, 6], [혜택시작, 혜택끝, 3, 8], [설문시작, 설문끝 + 1, 3, 6], [배너시작, 배너끝 + 1, 3, 5], [경로시작, 경로시작 + 7, 3, 6], [전체행, 구성끝, 3, 4]];
  표범위.forEach(([a, b, c1, c2]) => { 시트.getRange(a, c1, b - a + 1, c2 - c1 + 1).setHorizontalAlignment('center'); });
  [[비교시작, 비교끝, 2, 10], [혜택시작, 혜택끝, 2, 9], [설문시작, 설문끝 + 1, 2, 6], [배너시작, 배너끝 + 1, 2, 5], [경로시작, 경로시작 + 7, 2, 6]].forEach(([a, b, c1, c2]) => {
    시트.getRange(a, c1, b - a + 1, c2 - c1 + 1).setBorder(null, null, true, null, null, true, 선색, SpreadsheetApp.BorderStyle.SOLID);
  });
  시트.getRange(화면표 + 1, 3, 24, 3).setHorizontalAlignment('center');

  // 입력 칸
  입력칸.forEach(([rr, c, w]) => 시트.getRange(rr, c, 1, w).setBackground(입력배경).setFontColor(입력글자).setHorizontalAlignment('center').setBorder(true, true, true, true, null, null, 선색, SpreadsheetApp.BorderStyle.SOLID));

  // 설명 글
  작은글.forEach(([rr, c, w]) => {
    시트.getRange(rr, c, 1, w).setFontColor(회색).setFontSize(9).setWrap(true);
    if (w === 9) 시트.setRowHeight(rr, 32);   // 표 아래 설명 줄(두 줄까지)
  });
  줄바꿈.forEach(rr => { 시트.getRange(rr, 2).setWrap(true).setVerticalAlignment('top'); 시트.setRowHeight(rr, 44); });
  시트.getRange(혜택시작, 9, 혜택끝 - 혜택시작 + 1, 1).setFontColor(회색).setFontSize(9);
  시트.getRange(점검.기록, 3, 6, 1).setHorizontalAlignment('left');

  // 병합은 값을 쓴 뒤에 한다
  병합.forEach(([rr, c, 세로, 가로]) => 시트.getRange(rr, c, 세로, 가로).merge());

  // 한눈에 보기 카드
  카드칸.forEach(([위, c, w]) => {
    const 블록 = 시트.getRange(위, c, 3, w);
    블록.setBackground('#F7F8FA').setHorizontalAlignment('center').setBorder(true, true, true, true, null, null, 선색, SpreadsheetApp.BorderStyle.SOLID);
    시트.getRange(위, c, 1, w).setFontSize(9).setFontColor(회색).setFontWeight('bold');
    시트.getRange(위 + 1, c, 1, w).setFontSize(22).setFontWeight('bold').setFontColor(주색);
    시트.getRange(위 + 2, c, 1, w).setFontSize(9).setFontColor(회색);
  });
  [9, 13].forEach(rr => 시트.setRowHeight(rr, 24));
  [10, 14].forEach(rr => 시트.setRowHeight(rr, 42));
  [11, 15].forEach(rr => 시트.setRowHeight(rr, 24));
  [12, 16].forEach(rr => 시트.setRowHeight(rr, 12));
  시트.getRange(9, 2, 7, 8).setWrap(false);

  // 비교·점검 글자 색
  const 규칙 = [];
  const 비교칸 = 시트.getRange(비교시작, 6, 비교끝 - 비교시작 + 1, 1);
  규칙.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('높음 ▲').setFontColor('#1A56DB').setBold(true).setRanges([비교칸]).build());
  규칙.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('낮음 ▼').setFontColor('#E8710A').setBold(true).setRanges([비교칸]).build());
  규칙.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('표본 적음').setFontColor(회색).setRanges([비교칸]).build());
  규칙.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('⚠').setFontColor('#E03131').setBold(true).setRanges([시트.getRange(점검.열, 3, 2, 1), 시트.getRange(6, 7)]).build());
  시트.setConditionalFormatRules(규칙);

  /* --- 차트 (세 개를 나란히) --- */
  const 차트 = (유형, 제목, 범위들, 열번호, 너비) => {
    let b = 시트.newChart().setChartType(유형).setNumHeaders(1).setPosition(18, 열번호, 0, 4)
      .setOption('title', 제목).setOption('legend', { position: 'none' }).setOption('colors', [주색])
      .setOption('width', 너비).setOption('height', 320);
    범위들.forEach(rg => { b = b.addRange(rg); });
    시트.insertChart(b.build());
  };
  차트(Charts.ChartType.COLUMN, '샘플 설문 단계별 도달(명)', [시트.getRange(설문시작 - 1, 2, 설문끝 - 설문시작 + 2, 2)], 2, 390);
  차트(Charts.ChartType.COLUMN, '배너별 클릭률', [시트.getRange(배너시작 - 1, 2, 배너끝 - 배너시작 + 2, 1), 시트.getRange(배너시작 - 1, 5, 배너끝 - 배너시작 + 2, 1)], 5, 390);
  차트(Charts.ChartType.BAR, '혜택 질문별 쓸 의향 비율', [시트.getRange(혜택시작 - 1, 2, 혜택끝 - 혜택시작 + 2, 1), 시트.getRange(혜택시작 - 1, 7, 혜택끝 - 혜택시작 + 2, 1)], 9, 470);

  시트.setActiveRange(시트.getRange('B1'));
  SpreadsheetApp.flush();
  try { 문서.toast('대시보드를 만들었어요. 숫자가 비어 있으면 몇 초 뒤 다시 보세요.', 'QFlowz', 8); } catch (e) {}
}

// 계산용 탭(_data): events 에서 시험용 src 행을 뺀 사본. 이름 열(U)은 가져오지 않는다
function 계산탭만들기(문서, 기록) {
  let 계산 = 문서.getSheetByName(계산이름);
  if (!계산) 계산 = 문서.insertSheet(계산이름);
  계산.showSheet();
  계산.clear();
  if (계산.getMaxRows() < 기록.getMaxRows()) 계산.insertRowsAfter(계산.getMaxRows(), 기록.getMaxRows() - 계산.getMaxRows());
  계산.getRange(1, 1, 1, 20).setValues([기대열.slice(0, 20)]).setFontWeight('bold');
  const 제외칸 = `'${대시보드이름}'!$C$4`;
  계산.getRange('A2').setFormula(`=IFERROR(FILTER('${기록이름}'!$A$2:$T, '${기록이름}'!$D$2:$D<>"", '${기록이름}'!$G$2:$G<>IF(${제외칸}="", "(없음)", ${제외칸})), "")`);
  // 방문(sid)별로 가장 큰 session_time 초 — 방문 1회의 체류 시간
  계산.getRange('W1').setFormula(`=IFERROR(QUERY($A$1:$T, "select C, max(N) where D='session_time' group by C label C '방문', max(N) '체류(초)'", 1), "")`);
  계산.hideSheet();
}

// 옛 대시보드의 입력 칸 값을 이름표(B열)로 찾아 모은다
function 이전입력(옛, 입력라벨) {
  const 맵 = {};
  if (!옛 || 옛.getLastRow() < 1) return 맵;
  옛.getRange(1, 2, 옛.getLastRow(), 2).getValues().forEach(([라벨, 값]) => {
    const 키 = String(라벨).trim();
    if (키 && 입력라벨.indexOf(키) >= 0 && !Object.prototype.hasOwnProperty.call(맵, 키)) 맵[키] = 값;
  });
  return 맵;
}
