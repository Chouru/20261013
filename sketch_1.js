// p5.js 題庫測驗：使用 loadStrings 讀取，再以 RFC 4180 相容解析器處理 CSV。
// index.html、sketch.js、questions.csv 必須放在同一個資料夾。

const CSV_FILE = "questions.csv";
const QUESTION_COUNT = 5;
const REQUIRED_FIELDS = ["id", "question", "option_a", "option_b", "option_c", "option_d", "answer"];
const OPTION_KEYS = ["option_a", "option_b", "option_c", "option_d"];
const OPTION_LABELS = ["A", "B", "C", "D"];

let questionBank = [];
let currentQuestions = [];
let selectedAnswers = [];
let hasChecked = false;
let statusElement;
let messageElement;
let quizElement;
let resultElement;
let reloadButton;
let checkButton;

function setup() {
  noCanvas();
  createLayout();
  loadQuestionBank();
}

function createLayout() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <header>
      <h1>繁體中文題庫小測驗</h1>
      <p class="subtitle">每次從題庫不重複隨機抽取 5 題，作答後即可檢查答案。</p>
    </header>
    <div class="notice"><strong>開啟方式提醒：</strong>請使用 p5.js Editor，或在此資料夾執行 <code>python -m http.server 8000</code> 後開啟 <code>http://localhost:8000</code>。不要直接用 <code>file://</code> 開啟，否則瀏覽器可能禁止讀取 CSV。</div>
    <div class="toolbar">
      <button id="reload-button" type="button">重新抽題</button>
      <button id="check-button" type="button" disabled>檢查答案</button>
      <span id="status" aria-live="polite">正在載入題庫……</span>
    </div>
    <div id="message" role="alert"></div>
    <section id="quiz" aria-label="測驗題目"></section>
    <div id="result" aria-live="polite"></div>
    <footer>題庫資料來源：同一資料夾內的 questions.csv；正確答案會在檢查後顯示。</footer>
  `;

  statusElement = document.getElementById("status");
  messageElement = document.getElementById("message");
  quizElement = document.getElementById("quiz");
  resultElement = document.getElementById("result");
  reloadButton = document.getElementById("reload-button");
  checkButton = document.getElementById("check-button");
  reloadButton.addEventListener("click", drawNewQuestions);
  checkButton.addEventListener("click", checkAnswers);
}

function loadQuestionBank() {
  clearMessage();
  setStatus(`正在載入 ${CSV_FILE}……`);
  checkButton.disabled = true;

  // loadStrings 由 p5.js 載入檔案，後面的自訂解析器可處理欄位內逗號、雙引號、換行與 UTF-8。
  loadStrings(CSV_FILE, function (lines) {
    try {
      const csvText = Array.isArray(lines) ? lines.join("\n") : String(lines);
      const records = parseCSV(csvText);
      questionBank = recordsToQuestions(records);

      if (questionBank.length < QUESTION_COUNT) {
        throw new Error(`有效題目只有 ${questionBank.length} 題，至少需要 ${QUESTION_COUNT} 題才能抽題。`);
      }

      setStatus(`成功載入 ${questionBank.length} 題；可以抽取 ${QUESTION_COUNT} 題。`);
      drawNewQuestions();
    } catch (error) {
      questionBank = [];
      showError(`CSV 內容解析失敗：${error.message}`, "CSV 格式錯誤");
    }
  }, function (error) {
    questionBank = [];
    showError(formatLoadError(error), "題庫載入失敗");
  });
}

// 解析標準 CSV：逗號只在未加引號時分隔；雙引號以兩個雙引號表示。
function parseCSV(text) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let lineNumber = 1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
        if (character === "\n") lineNumber += 1;
      }
    } else if (character === '"' && field.trim() === "") {
      inQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      field = "";
      if (!(record.length === 1 && record[0].trim() === "")) records.push(record);
      record = [];
      lineNumber += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error(`第 ${lineNumber} 行的雙引號沒有成對結束。`);
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (!(record.length === 1 && record[0].trim() === "")) records.push(record);
  }
  if (records.length === 0) throw new Error("檔案是空的。");
  return records;
}

function cleanHeader(value) {
  // BOM 可能出現在第一個標頭前；trim 同時處理前後空白。
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function cleanValue(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function recordsToQuestions(records) {
  const headers = records[0].map(cleanHeader);
  const missingFields = REQUIRED_FIELDS.filter((field) => !headers.includes(field));
  if (missingFields.length > 0) {
    throw new Error(`缺少必要欄位：${missingFields.join(", ")}。實際欄位為：${headers.join(", ")}`);
  }

  const fieldIndexes = Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, headers.indexOf(field)]));
  const rows = [];
  records.slice(1).forEach((record, recordIndex) => {
    if (record.every((value) => cleanValue(value) === "")) return;
    if (record.length !== headers.length) {
      throw new Error(`第 ${recordIndex + 2} 列有 ${record.length} 個欄位，但標頭有 ${headers.length} 個；請檢查逗號是否放在雙引號內。`);
    }

    const row = {};
    REQUIRED_FIELDS.forEach((field) => {
      row[field] = cleanValue(record[fieldIndexes[field]]);
    });
    row.answer = normalizeAnswer(row.answer, row);
    const missingValues = REQUIRED_FIELDS.filter((field) => row[field] === "");
    if (missingValues.length > 0) {
      throw new Error(`第 ${recordIndex + 2} 列缺少值：${missingValues.join(", ")}`);
    }
    if (!row.answer) throw new Error(`第 ${recordIndex + 2} 列的 answer 必須是 A、B、C 或 D。`);
    rows.push(row);
  });
  return rows;
}

function normalizeAnswer(answer, row) {
  const value = cleanValue(answer).toUpperCase().replace(/[.、)]$/, "");
  if (OPTION_LABELS.includes(value)) return value;
  const numberIndex = ["1", "2", "3", "4"].indexOf(value);
  if (numberIndex >= 0) return OPTION_LABELS[numberIndex];
  const optionIndex = OPTION_KEYS.findIndex((key) => cleanValue(row[key]).toUpperCase() === value);
  return optionIndex >= 0 ? OPTION_LABELS[optionIndex] : "";
}

function drawNewQuestions() {
  clearMessage();
  resultElement.innerHTML = "";
  resultElement.classList.remove("show");
  hasChecked = false;

  if (questionBank.length < QUESTION_COUNT) {
    showError(`目前只有 ${questionBank.length} 題，至少需要 ${QUESTION_COUNT} 題才能抽題。`, "無法抽題");
    return;
  }

  // Fisher-Yates 洗牌後取前 5 題，保證同一回合不重複。
  currentQuestions = shuffle([...questionBank]).slice(0, QUESTION_COUNT);
  selectedAnswers = Array(QUESTION_COUNT).fill("");
  renderQuestions();
  checkButton.disabled = false;
  setStatus(`成功載入 ${questionBank.length} 題；本次已不重複抽取 ${QUESTION_COUNT} 題。`);
}

function renderQuestions() {
  quizElement.innerHTML = "";
  currentQuestions.forEach((item, questionIndex) => {
    const card = document.createElement("article");
    card.className = "question-card";
    const title = document.createElement("h2");
    title.className = "question-title";
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `第 ${questionIndex + 1} 題`;
    title.append(number, document.createTextNode(` ${item.question}`));
    card.appendChild(title);

    const options = document.createElement("div");
    options.className = "options";
    OPTION_KEYS.forEach((key, optionIndex) => {
      const label = document.createElement("label");
      label.className = "option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `question-${questionIndex}`;
      input.value = OPTION_LABELS[optionIndex];
      input.addEventListener("change", () => {
        selectedAnswers[questionIndex] = input.value;
        if (hasChecked) clearResultsAfterChange();
      });
      const text = document.createElement("span");
      text.textContent = `${OPTION_LABELS[optionIndex]}. ${item[key]}`;
      label.append(input, text);
      options.appendChild(label);
    });
    card.appendChild(options);
    quizElement.appendChild(card);
  });
}

function checkAnswers() {
  if (currentQuestions.length !== QUESTION_COUNT) return;
  hasChecked = true;
  let score = 0;
  const reviews = [];

  currentQuestions.forEach((item, questionIndex) => {
    const selected = selectedAnswers[questionIndex];
    const correct = item.answer;
    const isCorrect = selected === correct;
    if (isCorrect) score += 1;
    const card = quizElement.children[questionIndex];
    card.querySelectorAll(".option").forEach((option) => {
      const input = option.querySelector("input");
      option.classList.toggle("correct", input.value === correct);
      option.classList.toggle("incorrect", input.checked && input.value !== correct);
    });
    const detail = isCorrect ? "答對" : `答錯（你的答案：${selected || "未作答"}；正確答案：${correct}）`;
    reviews.push(`<div class="${isCorrect ? "right" : "wrong"}">第 ${questionIndex + 1} 題：${escapeHTML(detail)}</div>`);
  });

  resultElement.innerHTML = `本次得分：${score} / ${QUESTION_COUNT}<div class="review">${reviews.join("")}</div>`;
  resultElement.classList.add("show");
}

function clearResultsAfterChange() {
  hasChecked = false;
  resultElement.innerHTML = "";
  resultElement.classList.remove("show");
  quizElement.querySelectorAll(".option").forEach((option) => option.classList.remove("correct", "incorrect"));
}

function formatLoadError(error) {
  const details = error && (error.message || error.statusText || error.status)
    ? `\n實際錯誤：${error.message || error.statusText || `HTTP ${error.status}`}`
    : "\n實際錯誤：瀏覽器未提供詳細錯誤。";
  return `無法讀取 ${CSV_FILE}。請確認檔案名稱完全相同、與 index.html 在同一資料夾，且使用 p5.js Editor 或本機 HTTP 伺服器開啟。${details}`;
}

function showError(message, status) {
  quizElement.innerHTML = "";
  resultElement.innerHTML = "";
  resultElement.classList.remove("show");
  checkButton.disabled = true;
  setStatus(status);
  messageElement.textContent = `${status}：${message}`;
  messageElement.classList.add("show");
}

function clearMessage() {
  messageElement.textContent = "";
  messageElement.classList.remove("show");
}

function setStatus(message) {
  statusElement.textContent = message;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[randomIndex]] = [items[randomIndex], items[index]];
  }
  return items;
}
