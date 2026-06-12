import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";

// ================= 復古 8-Bit 音效合成器 (Web Audio API) =================
const Synth = {
  ctx: null,
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },
  
  // 基礎方波/三角波嗶聲
  playBeep(freq, duration, type = "square", volume = 0.1) {
    this.init();
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  },
  
  // 計數滴答聲
  playTick() {
    this.playBeep(880, 0.05, "triangle", 0.08);
  },
  
  // 警告嗶聲
  playWarning() {
    this.playBeep(180, 0.25, "sawtooth", 0.15);
  },
  
  // 倒數嗶聲
  playCountdown() {
    this.playBeep(987.77, 0.08, "square", 0.08); // B5 note
  },
  
  // 開機音
  playPowerOn() {
    this.playBeep(440, 0.1, "sine", 0.1);
    setTimeout(() => this.playBeep(880, 0.2, "sine", 0.1), 100);
  },
  
  // 成功通關和弦 (8-Bit 琶音)
  playSuccessChime() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => {
        this.playBeep(freq, 0.18, "square", 0.08);
      }, idx * 80);
    });
  }
};

// ================= 常數與 MediaPipe 索引 =================
const LS_ID = 11, RS_ID = 12; // 左右肩
const LE_ID = 13, RE_ID = 14; // 左右肘
const LW_ID = 15, RW_ID = 16; // 左右腕
const LH_ID = 23, RH_ID = 24; // 左右臀
const LK_ID = 25, RK_ID = 26; // 左右膝
const LA_ID = 27, RA_ID = 28; // 左右踝

// 動作定義
const EXERCISES = [
  {
    name: "深蹲",
    numStr: "一",
    desc: "請側身站立。雙腳與肩同寬，手向前平舉，臀部向後坐深蹲。膝蓋彎曲接近 90 度，重心在後腳跟，避免膝蓋過度前傾。",
    criteria: [
      "下蹲時膝蓋夾角需小於 100°",
      "雙手需向前平舉 (手肘夾角 > 150°)",
      "重心偏移小於 30px (臀部與腳踝水平對位)"
    ]
  },
  {
    name: "半蹲",
    numStr: "二",
    desc: "請正面站立。雙腳張開比肩略寬，雙手插腰，膝蓋微彎下蹲，大腿與小腿夾角約 120-140 度。保持身體直立，骨盆不要傾斜。",
    criteria: [
      "正面站立 (肩寬 X 差距大於寬度 15%)",
      "膝蓋微彎 (夾角在 110° - 140° 之間)",
      "雙手插腰 (手腕接近臀部高度)"
    ]
  },
  {
    name: "手上舉",
    numStr: "三",
    desc: "請正面站立。雙手從身體兩側向上伸直高舉過頭，掌心相對。手臂貼近耳朵，保持身體中軸直立，雙腿伸直不彎曲。",
    criteria: [
      "雙手腕需高於肩膀 (Wrist Y < Shoulder Y)",
      "手臂需伸直 (手肘夾角 > 155°)",
      "身體中軸直立 (兩肩與兩髖維持水平)"
    ]
  },
  {
    name: "腰部扭轉",
    numStr: "四",
    desc: "請正面站立。雙手插腰或平舉，以腰部為軸心進行左右扭轉。骨盆保持朝前穩定，利用胸腔與肩膀的旋轉帶動動作。",
    criteria: [
      "旋轉幅度需達標 (肩寬/臀寬比例 < 0.70)",
      "骨盆維持水平穩定，避免隨之大晃動",
      "膝蓋保持微彎但不左右搖擺"
    ]
  },
  {
    name: "體側彎",
    numStr: "五",
    desc: "請正面站立。單手高舉過頭，另一手插腰，身體朝著插腰的一側側彎。側邊肌肉伸展，骨盆維持中軸不左右滑動。",
    criteria: [
      "身體側彎角度需大於 22°",
      "上舉之手臂手腕高於肩膀且高舉過頭",
      "骨盆左右偏移 (Hip Shift) 小於 0.08"
    ]
  },
  {
    name: "體前彎",
    numStr: "六",
    desc: "請正面站立。雙手自然下垂，上半身向前彎曲，臀部向後，雙手盡量往下摸到腳趾或地板，雙膝儘量保持伸直不彎曲。",
    criteria: [
      "上半身向前下彎 (髖關節角度 < 120°)",
      "手腕低於臀部高度 (Wrist Y > Hip Y + 0.15)",
      "雙膝伸直 (膝蓋夾角 > 150°)"
    ]
  },
  {
    name: "四肢伸展",
    numStr: "七",
    desc: "請正面站立。雙腳向兩側跨開（寬於臀部的 1.35 倍），雙手向兩側斜上方張開呈大字形。全身大張伸展，四肢關節伸直。",
    criteria: [
      "雙腳大張 (踝距 > 1.35 * 臀寬)",
      "雙手朝兩側斜上張開 (手腕高於肩，兩腕寬度大)",
      "肘關節與膝關節完全伸直"
    ]
  },
  {
    name: "深呼吸",
    numStr: "八",
    desc: "請正面站立。配合節奏，吸氣時雙手由下往上緩慢抬起，胸腔擴張；吐氣時雙手緩慢放下，全身放鬆，調節呼吸至平穩。",
    criteria: [
      "吸氣：雙手腕緩慢上升至高於肩膀",
      "吐氣：雙手腕緩慢下降至低於髖部",
      "呼吸循環頻率需緩慢穩定 (一次約 3-4 秒)"
    ]
  }
];

// ================= DOM 元素 =================
const webcamElement = document.getElementById("webcam");
const canvasElement = document.getElementById("output-canvas");
const ctx = canvasElement.getContext("2d");
const loadingOverlay = document.getElementById("loading-overlay");
const modelStatusDot = document.getElementById("model-status-dot");
const modelStatusText = document.getElementById("model-status-text");
const fpsCounter = document.getElementById("fps-counter");
const osdWorkoutMode = document.getElementById("osd-workout-mode");

const btnToggleCamera = document.getElementById("btn-toggle-camera");
const chkMirror = document.getElementById("chk-mirror");
const chkTts = document.getElementById("chk-tts");
const chkSfx = document.getElementById("chk-sfx");

const modeRoutine = document.getElementById("mode-routine");
const modeSingle = document.getElementById("mode-single");

const repDisplay = document.getElementById("rep-display");
const repStatus = document.getElementById("rep-status");
const scoreDisplay = document.getElementById("score-display");
const scoreBar = document.getElementById("score-bar");
const feedbackList = document.getElementById("feedback-list");
const posePerfectBadge = document.getElementById("pose-perfect-badge");

const guideExerciseTitle = document.getElementById("guide-exercise-title");
const guideExerciseDesc = document.getElementById("guide-exercise-desc");
const guideExerciseCriteria = document.getElementById("guide-exercise-criteria");
const poseSvg = document.getElementById("pose-svg");
const metricsContainer = document.getElementById("metrics-container");

const countdownOverlay = document.getElementById("countdown-overlay");
const countdownTitle = document.getElementById("countdown-title");
const countdownTimer = document.getElementById("countdown-timer");

// 新增：後端資料庫 DOM 元素
const athleteSelect = document.getElementById("athlete-select");
const newAthleteInput = document.getElementById("new-athlete-input");
const btnAddAthlete = document.getElementById("btn-add-athlete");
const historyListBody = document.getElementById("history-list-body");
const totalRepsStat = document.getElementById("total-reps-stat");
const avgScoreStat = document.getElementById("avg-score-stat");
const totalWorkoutsStat = document.getElementById("total-workouts-stat");

// ================= 應用程式狀態 =================
let activeIndex = 0; // 0 到 7，對應 8 小節
let workoutMode = "routine"; // "routine" (全套), "single" (單節)
let isCameraActive = false;
let poseLandmarker = null;
let webcamStream = null;
let animationFrameId = null;

// 運動計數與得分狀態
let repsCount = 0;
let lastRepTime = 0;
let repState = "neutral"; // "neutral", "underway", "holding"
let stableFrames = 0; // 用於維持秒數的影格數
let breathCycleState = "exhale-done"; // 深呼吸狀態機："exhale-done", "inhaling", "inhale-done", "exhaling"

// 用於計算平均分數與追蹤時間
let currentUserId = null;
let currentSessionScores = []; // 收集每一幀的分數以計算平均
let sessionStartTime = null;   // 記錄單節或全套開始時間
let currentRoutineDetails = []; // 存儲全套各小節的詳細數據

// 暫存顯示狀態
let cachedState = {
  score: 100,
  feedback: [],
  perfect: true,
  landmarks: null
};

// 緩衝器 (平滑抖動)
const angleBuffer = [];
const ratioBuffer = [];
const BUFFER_MAX = 5;

// FPS
let lastFpsTime = performance.now();
let frameCount = 0;
let currentFps = 0;

// TTS
let lastSpeechTime = 0;
const SPEECH_COOLDOWN = 2500;

// ================= API 資料交互 =================

// 載入所有運動員
async function loadAthletes() {
  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    athleteSelect.innerHTML = "";
    
    if (data.length === 0) {
      athleteSelect.innerHTML = `<option value="" disabled selected>請先註冊運動員</option>`;
      currentUserId = null;
      renderEmptyHistory();
      return;
    }

    data.forEach(user => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.username;
      athleteSelect.appendChild(option);
    });

    // 預設選擇第一個運動員
    athleteSelect.selectedIndex = 0;
    currentUserId = athleteSelect.value;
    loadAthleteHistory(currentUserId);
  } catch (err) {
    console.error("載入運動員失敗:", err);
    athleteSelect.innerHTML = `<option value="" disabled selected>連線失敗</option>`;
  }
}

// 註冊新運動員
async function registerAthlete() {
  const name = newAthleteInput.value.trim();
  if (!name) {
    alert("請輸入運動員姓名！");
    return;
  }
  try {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: name })
    });
    const data = await res.json();
    if (data.error) {
      alert(`註冊失敗: ${data.error}`);
    } else {
      newAthleteInput.value = "";
      alert("註冊運動員成功！");
      await loadAthletes();
      // 選取新註冊的運動員
      athleteSelect.value = data.id;
      currentUserId = data.id;
      loadAthleteHistory(data.id);
    }
  } catch (err) {
    console.error("註冊失敗:", err);
    alert("後端註冊請求出錯");
  }
}

// 載入個人歷程紀錄與匯總數據
async function loadAthleteHistory(userId) {
  if (!userId) return;
  try {
    // 獲取歷史列表
    const resLogs = await fetch(`/api/workouts?user_id=${userId}`);
    const logs = await resLogs.json();
    
    // 獲取彙總統計
    const resStats = await fetch(`/api/stats?user_id=${userId}`);
    const stats = await resStats.json();

    // 更新統計面板
    totalRepsStat.textContent = stats.total_reps || 0;
    avgScoreStat.textContent = stats.avg_score || 0;
    totalWorkoutsStat.textContent = stats.total_workouts || 0;

    // 渲染歷史表格
    historyListBody.innerHTML = "";
    if (logs.length === 0) {
      historyListBody.innerHTML = `<tr><td colspan="7" class="table-placeholder">尚無運動紀錄，開機即可開始做操！</td></tr>`;
      return;
    }

    logs.forEach(log => {
      const tr = document.createElement("tr");
      const dateStr = new Date(log.created_at).toLocaleString("zh-TW", { hour12: false });
      
      const modeText = log.mode === "routine" ? "全套套操" : `單節:${EXERCISES[parseInt(log.mode) || 0].name}`;
      
      // 細部小節報告 HTML
      let detailsHtml = "";
      if (log.section_details && log.section_details.length > 0) {
        log.section_details.forEach(d => {
          detailsHtml += `<span class="detail-badge">${EXERCISES[d.section_index].name}: ${d.reps}下/${Math.round(d.score)}分</span>`;
        });
      } else {
        detailsHtml = `<span class="detail-badge">-</span>`;
      }

      tr.innerHTML = `
        <td>${dateStr}</td>
        <td><strong>${modeText}</strong></td>
        <td>${log.reps} 次</td>
        <td><span style="color:${log.avg_score >= 85 ? "var(--vintage-green)" : "var(--vintage-yellow)"}">${Math.round(log.avg_score)} 分</span></td>
        <td>${log.duration_seconds} 秒</td>
        <td>${detailsHtml}</td>
        <td>
          <button class="btn-delete-log" data-id="${log.id}">刪除</button>
        </td>
      `;
      historyListBody.appendChild(tr);
    });

    // 綁定刪除按鈕事件
    document.querySelectorAll(".btn-delete-log").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const logId = e.target.getAttribute("data-id");
        if (confirm("確定要刪除這筆運動紀錄嗎？")) {
          await deleteWorkoutLog(logId);
        }
      });
    });

  } catch (err) {
    console.error("載入歷史紀錄失敗:", err);
  }
}

// 刪除紀錄
async function deleteWorkoutLog(id) {
  try {
    const res = await fetch(`/api/workouts/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      loadAthleteHistory(currentUserId);
    } else {
      alert("刪除失敗");
    }
  } catch (err) {
    console.error("刪除失敗:", err);
  }
}

function renderEmptyHistory() {
  historyListBody.innerHTML = `<tr><td colspan="7" class="table-placeholder">請先選擇或註冊做操運動員以載入健康存摺資料...</td></tr>`;
  totalRepsStat.textContent = "0";
  avgScoreStat.textContent = "0";
  totalWorkoutsStat.textContent = "0";
}

// 儲存當前動作紀錄到資料庫
async function submitWorkoutSession(isLastOfRoutine = false) {
  if (!currentUserId) {
    console.warn("未選取運動員，無法儲存紀錄。");
    return;
  }
  if (repsCount === 0 && currentSessionScores.length === 0) {
    return; // 沒有運動，不儲存
  }

  const duration = Math.max(1, Math.round((performance.now() - sessionStartTime) / 1000));
  const avgScore = currentSessionScores.length > 0
    ? currentSessionScores.reduce((a, b) => a + b, 0) / currentSessionScores.length
    : 100;

  let payload = {
    user_id: currentUserId,
    mode: workoutMode === "routine" ? "routine" : activeIndex.toString(),
    reps: repsCount,
    avg_score: Math.round(avgScore),
    duration_seconds: duration,
    section_details: []
  };

  if (workoutMode === "routine") {
    // 全套模式
    if (isLastOfRoutine) {
      // 收集先前小節的資料並加上最後一節
      currentRoutineDetails.push({
        section_index: activeIndex,
        reps: repsCount,
        score: avgScore
      });

      payload.section_details = currentRoutineDetails;
      // 計算全套的加權/平均總次數與分數
      payload.reps = currentRoutineDetails.reduce((sum, d) => sum + d.reps, 0);
      payload.avg_score = Math.round(currentRoutineDetails.reduce((sum, d) => sum + d.score, 0) / currentRoutineDetails.length);
    } else {
      // 全套模式的中間節點只暫存，暫不傳送後端
      currentRoutineDetails.push({
        section_index: activeIndex,
        reps: repsCount,
        score: avgScore
      });
      return;
    }
  } else {
    // 單節模式
    payload.section_details = [{
      section_index: activeIndex,
      reps: repsCount,
      score: avgScore
    }];
  }

  try {
    const res = await fetch("/api/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.id) {
      console.log("做操紀錄已儲存至資料庫，ID:", data.id);
      loadAthleteHistory(currentUserId);
    }
  } catch (err) {
    console.error("儲存做操紀錄出錯:", err);
  }
}

// ================= 初始化 AI 模型 =================
async function initPoseModel() {
  try {
    modelStatusText.textContent = "載入模型資源...";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });

    modelStatusText.textContent = "系統加溫完成";
    modelStatusDot.className = "status-dot green";
    loadingOverlay.classList.add("hidden");
    
    btnToggleCamera.classList.remove("btn-disabled");
    btnToggleCamera.disabled = false;
  } catch (error) {
    console.error("AI 模型載入失敗:", error);
    modelStatusText.textContent = "模型載入失敗";
    alert("MediaPipe 模型載入失敗，請檢查網路連線。");
  }
}

// ================= 語音播報 (Web Speech API) =================
function speakText(text) {
  if (!chkTts.checked) return;
  const now = Date.now();
  if (now - lastSpeechTime < SPEECH_COOLDOWN) return;

  window.speechSynthesis.cancel(); // 砍掉排隊中的發音

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 1.05; 
  
  const voices = window.speechSynthesis.getVoices();
  const zhVoice = voices.find(v => v.lang.includes("zh-TW") || v.lang.includes("zh-HK") || v.lang.includes("zh-CN"));
  if (zhVoice) {
    utterance.voice = zhVoice;
  }

  window.speechSynthesis.speak(utterance);
  lastSpeechTime = now;
}

// ================= 幾何力學計算 =================
function calculateAngle(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };

  const dotProduct = ba.x * bc.x + ba.y * bc.y;
  const normBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const normBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);

  if (normBA === 0 || normBC === 0) return 180.0;

  let cosAngle = dotProduct / (normBA * normBC);
  cosAngle = Math.max(-1.0, Math.min(1.0, cosAngle));
  
  const angleRad = Math.acos(cosAngle);
  return angleRad * (180.0 / Math.PI);
}

function calculateAngleFromRatio(shoulderWidth, hipWidth) {
  if (hipWidth <= 0) return 0.0;
  let ratio = shoulderWidth / hipWidth;
  ratio = Math.max(0.0, Math.min(1.0, ratio));
  if (ratio >= 1.0) return 0.0;
  return Math.acos(ratio) * (180.0 / Math.PI);
}

// ================= 相機控制 =================
async function toggleCamera() {
  if (isCameraActive) {
    // 關機前儲存本次做操紀錄
    await submitWorkoutSession(activeIndex === 7 && workoutMode === "routine");
    stopCamera();
  } else {
    Synth.init();
    if (chkSfx.checked) Synth.playPowerOn();
    await startCamera();
  }
}

async function startCamera() {
  if (!poseLandmarker) return;
  
  try {
    loadingOverlay.classList.remove("hidden");
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      },
      audio: false
    });
    
    webcamElement.srcObject = webcamStream;
    webcamElement.addEventListener("loadedmetadata", () => {
      canvasElement.width = webcamElement.videoWidth;
      canvasElement.height = webcamElement.videoHeight;
      
      loadingOverlay.classList.add("hidden");
      isCameraActive = true;
      btnToggleCamera.textContent = "關機 (CAM)";
      btnToggleCamera.style.backgroundColor = "#78716c";
      btnToggleCamera.style.boxShadow = "0 4px 0px #44403c";
      
      resetReps();
      sessionStartTime = performance.now();
      currentRoutineDetails = [];
      
      lastFpsTime = performance.now();
      frameCount = 0;
      animationFrameId = requestAnimationFrame(detectionLoop);
      
      speakText(`開機成功。第一代國民健康操，第 ${EXERCISES[activeIndex].numStr} 節：${EXERCISES[activeIndex].name}。預備，起！`);
    });
  } catch (error) {
    console.error("相機開啟失敗:", error);
    loadingOverlay.classList.add("hidden");
    alert("無法存取相機，請檢查瀏覽器隱私設定。");
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  
  webcamElement.srcObject = null;
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  isCameraActive = false;
  btnToggleCamera.textContent = "開機 (CAM)";
  btnToggleCamera.style.backgroundColor = "var(--vintage-red)";
  btnToggleCamera.style.boxShadow = "0 4px 0px #5f1512";
  fpsCounter.textContent = "FPS: 0.0";
  
  feedbackList.innerHTML = `<div class="feedback-placeholder">請啟動主開關，並站立於畫面前開始做操...</div>`;
  posePerfectBadge.classList.remove("visible");
  
  speakText("關機");
}

function resetReps() {
  repsCount = 0;
  updateRepDisplay();
  stableFrames = 0;
  repState = "neutral";
  angleBuffer.length = 0;
  ratioBuffer.length = 0;
  breathCycleState = "exhale-done";
  currentSessionScores = [];
  sessionStartTime = performance.now();
}

function updateRepDisplay() {
  repDisplay.textContent = repsCount < 10 ? `0${repsCount}` : repsCount;
}

// ================= 運動切換控制 =================
async function selectExercise(idx) {
  if (idx < 0 || idx >= 8) return;
  
  // 在切換小節前，若相機開啟，儲存上一小節紀錄
  if (isCameraActive) {
    await submitWorkoutSession(false);
  }

  activeIndex = idx;
  
  // 更新郵票狀態
  const stamps = document.querySelectorAll(".stamp-item");
  stamps.forEach((stamp, sIdx) => {
    stamp.classList.remove("active");
    if (sIdx === idx) {
      stamp.classList.add("active");
    }
  });
  
  // 更新動作指南海報
  const ex = EXERCISES[idx];
  guideExerciseTitle.textContent = `第${ex.numStr}節：${ex.name}`;
  guideExerciseDesc.textContent = ex.desc;
  
  // 更新合格標準列表
  guideExerciseCriteria.innerHTML = ex.criteria.map(c => `<li>${c}</li>`).join("");
  
  // 更新示範簡圖 SVG
  updatePoseSvg(idx);
  
  // 重置計數
  resetReps();
  
  if (isCameraActive) {
    speakText(`第 ${ex.numStr} 節：${ex.name}。預備，起！`);
  }
}

// ================= 核心偵測運算迴圈 =================
function detectionLoop() {
  if (!isCameraActive || !poseLandmarker) return;
  
  frameCount++;
  const timeNow = performance.now();
  if (timeNow - lastFpsTime >= 1000) {
    currentFps = (frameCount * 1000) / (timeNow - lastFpsTime);
    fpsCounter.textContent = `FPS: ${currentFps.toFixed(1)}`;
    frameCount = 0;
    lastFpsTime = timeNow;
  }

  const timestampMs = performance.now();
  const result = poseLandmarker.detectForVideo(webcamElement, timestampMs);
  
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  const w = canvasElement.width;
  const h = canvasElement.height;

  let currentPerfect = true;
  let currentFeedback = [];
  let currentScore = 100;
  let metricsHTML = "";

  if (result.landmarks && result.landmarks.length > 0) {
    const lm = result.landmarks[0];
    
    if (lm.length >= 29) {
      cachedState.landmarks = lm;
      const timeSec = Date.now() / 1000;
      
      // 提取核心骨骼節點
      const ls = lm[LS_ID], rs = lm[RS_ID];
      const le = lm[LE_ID], re = lm[RE_ID];
      const lw = lm[LW_ID], rw = lm[RW_ID];
      const lh = lm[LH_ID], rh = lm[RH_ID];
      const lk = lm[LK_ID], rk = lm[RK_ID];
      const la = lm[LA_ID], ra = lm[RA_ID];

      // 計算肩膀中點與臀部中點
      const shoulderCenter = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
      const hipCenter = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
      const feetCenter = { x: (la.x + ra.x) / 2, y: (la.y + ra.y) / 2 };

      // 1. ================= 8個小節動作檢測幾何演算法 =================
      if (activeIndex === 0) {
        // 深蹲 (側身)
        const ls_x = ls.x * w;
        const rs_x = rs.x * w;
        
        if (Math.abs(ls_x - rs_x) < w * 0.1) {
          let sideLabel = "";
          let s_idx = 11, h_idx = 23, k_idx = 25, e_idx = 13, a_idx = 27, w_idx = 15;
          
          if (ls_x < rs_x) {
            sideLabel = "左側在前 (面向右)";
          } else {
            sideLabel = "右側在前 (面向左)";
            s_idx = 12; h_idx = 24; k_idx = 26; e_idx = 14; a_idx = 28; w_idx = 16;
          }
          
          const shoulderPt = { x: lm[s_idx].x * w, y: lm[s_idx].y * h };
          const hipPt = { x: lm[h_idx].x * w, y: lm[h_idx].y * h };
          const kneePt = { x: lm[k_idx].x * w, y: lm[k_idx].y * h };
          const elbowPt = { x: lm[e_idx].x * w, y: lm[e_idx].y * h };
          const anklePt = { x: lm[a_idx].x * w, y: lm[a_idx].y * h };
          const wristPt = { x: lm[w_idx].x * w, y: lm[w_idx].y * h };
          
          const kneeAngle = calculateAngle(hipPt, kneePt, anklePt);
          const armAngle = calculateAngle(shoulderPt, elbowPt, wristPt);
          
          let centerOffset = 0;
          if (sideLabel.includes("面向右")) {
            centerOffset = anklePt.x - hipPt.x;
          } else {
            centerOffset = hipPt.x - anklePt.x;
          }
          
          if (kneeAngle < 100 && repState === "neutral") {
            repState = "underway";
            repStatus.textContent = "下蹲中";
            repStatus.style.color = "var(--vintage-yellow)";
            if (timeSec - lastRepTime > 2.0) speakText("向下蹲");
          } else if (repState === "underway" && kneeAngle > 150) {
            if (timeSec - lastRepTime > 1.2) {
              repsCount++;
              updateRepDisplay();
              lastRepTime = timeSec;
              repState = "neutral";
              repStatus.textContent = "起立";
              repStatus.style.color = "var(--vintage-green)";
              if (chkSfx.checked) Synth.playTick();
              speakText(`第 ${repsCount} 下`);
            }
          }
          
          let scorePart = 100;
          if (kneeAngle > 105) {
            scorePart -= Math.min(30, (kneeAngle - 105) * 1.5);
            currentFeedback.push("下蹲深度不足，請臀部再坐低");
            currentPerfect = false;
          } else if (kneeAngle < 70) {
            scorePart -= 15;
            currentFeedback.push("下蹲過深，膝蓋受壓過大");
            currentPerfect = false;
          }
          
          if (armAngle < 150) {
            scorePart -= 20;
            currentFeedback.push("雙手請向前伸直平行地面");
            currentPerfect = false;
          }
          
          if (centerOffset < -30) {
            scorePart -= 20;
            currentFeedback.push("重心太靠前，請將體重放回腳跟");
            currentPerfect = false;
          }
          
          currentScore = Math.max(10, Math.round(scorePart));
          
          metricsHTML = `
            <div class="metric-item">
              <span class="metric-lbl">視角判定</span>
              <span class="metric-val" style="color:var(--vintage-green)">側身 (${sideLabel.split(" ")[0]})</span>
            </div>
            <div class="metric-item">
              <span class="metric-lbl">膝蓋角度</span>
              <span class="metric-val" style="color:${kneeAngle < 105 ? "var(--vintage-green)" : "var(--vintage-red)"}">${Math.round(kneeAngle)}°</span>
            </div>
            <div class="metric-item">
              <span class="metric-lbl">手肘角度</span>
              <span class="metric-val">${Math.round(armAngle)}°</span>
            </div>
            <div class="metric-item">
              <span class="metric-lbl">重心位移</span>
              <span class="metric-val">${Math.round(centerOffset)} px</span>
            </div>
          `;
        } else {
          currentScore = 30;
          currentPerfect = false;
          currentFeedback.push("請側身轉向側面 (90度) 以便檢測深蹲");
          repStatus.textContent = "請轉向";
          repStatus.style.color = "var(--vintage-red)";
          
          metricsHTML = `
            <div class="metric-item">
              <span class="metric-lbl">視角判定</span>
              <span class="metric-val" style="color:var(--vintage-red)">正面 (錯誤視角)</span>
            </div>
          `;
        }
        
      } else if (activeIndex === 1) {
        // 半蹲 (正面)
        const ls_x = ls.x * w;
        const rs_x = rs.x * w;
        
        if (Math.abs(ls_x - rs_x) >= w * 0.13) {
          const leftKneeAngle = calculateAngle(lh, lk, la);
          const rightKneeAngle = calculateAngle(rh, rk, ra);
          const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
          
          const leftWristToHip = Math.abs(lw.y - lh.y);
          const rightWristToHip = Math.abs(rw.y - rh.y);
          const isHandsOnHips = (leftWristToHip < 0.12 && rightWristToHip < 0.12);
          
          if (avgKneeAngle < 140 && avgKneeAngle > 110 && repState === "neutral") {
            repState = "underway";
            repStatus.textContent = "半蹲中";
            repStatus.style.color = "var(--vintage-yellow)";
            if (timeSec - lastRepTime > 2.0) speakText("微彎半蹲");
          } else if (repState === "underway" && avgKneeAngle > 155) {
            if (timeSec - lastRepTime > 1.0) {
              repsCount++;
              updateRepDisplay();
              lastRepTime = timeSec;
              repState = "neutral";
              repStatus.textContent = "起立";
              repStatus.style.color = "var(--vintage-green)";
              if (chkSfx.checked) Synth.playTick();
              speakText(`第 ${repsCount} 下`);
            }
          }
          
          let scorePart = 100;
          if (avgKneeAngle > 140) {
            scorePart -= Math.min(25, (avgKneeAngle - 140) * 1.5);
            currentFeedback.push("下蹲不夠，請膝蓋再稍微彎曲");
            currentPerfect = false;
          } else if (avgKneeAngle < 110) {
            scorePart -= 20;
            currentFeedback.push("下蹲太深！這是半蹲，請稍微起身");
            currentPerfect = false;
          }
          
          if (!isHandsOnHips) {
            scorePart -= 20;
            currentFeedback.push("請雙手插腰，手掌靠在兩側骨盆");
            currentPerfect = false;
          }
          
          const hipTilt = Math.abs(lh.y - rh.y);
          if (hipTilt > 0.06) {
            scorePart -= 15;
            currentFeedback.push("骨盆歪斜，請保持身體對稱直立");
            currentPerfect = false;
          }
          
          currentScore = Math.max(10, Math.round(scorePart));
          
          metricsHTML = `
            <div class="metric-item">
              <span class="metric-lbl">膝蓋平均角</span>
              <span class="metric-val">${Math.round(avgKneeAngle)}°</span>
            </div>
            <div class="metric-item">
              <span class="metric-lbl">雙手插腰</span>
              <span class="metric-val" style="color:${isHandsOnHips ? "var(--vintage-green)" : "var(--vintage-yellow)"}">${isHandsOnHips ? "已插腰" : "未插腰"}</span>
            </div>
            <div class="metric-item">
              <span class="metric-lbl">骨盆偏角</span>
              <span class="metric-val">${hipTilt.toFixed(3)}</span>
            </div>
          `;
        } else {
          currentScore = 30;
          currentPerfect = false;
          currentFeedback.push("請轉向正面對準鏡頭以偵測半蹲");
          repStatus.textContent = "請轉正";
          repStatus.style.color = "var(--vintage-red)";
        }
        
      } else if (activeIndex === 2) {
        // 手上舉
        const leftArmStraight = calculateAngle(lh, le, lw);
        const rightArmStraight = calculateAngle(rh, re, rw);
        const isLeftUp = lw.y < ls.y;
        const isRightUp = rw.y < rs.y;
        
        let scorePart = 100;
        if (!isLeftUp || !isRightUp) {
          scorePart -= 40;
          currentFeedback.push("雙手高舉，需抬高超過肩膀");
          currentPerfect = false;
        }
        
        if (leftArmStraight < 155 || rightArmStraight < 155) {
          scorePart -= 25;
          currentFeedback.push("雙手手肘請盡量伸直");
          currentPerfect = false;
        }
        
        const armDistance = Math.abs(lw.x - rw.x);
        const shoulderDistance = Math.abs(ls.x - rs.x);
        if (armDistance > shoulderDistance * 2.2) {
          scorePart -= 15;
          currentFeedback.push("手舉得太開了，請與雙肩同寬直立");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        const isPoseCorrect = (currentScore >= 80);
        if (isPoseCorrect) {
          stableFrames++;
          repStatus.textContent = `維持: ${Math.floor(stableFrames/15)}/4 秒`;
          repStatus.style.color = "var(--vintage-yellow)";
          
          if (stableFrames > 0 && stableFrames % 30 === 0) {
            repsCount = Math.floor(stableFrames / 30);
            updateRepDisplay();
            if (chkSfx.checked) Synth.playTick();
            speakText(`第 ${repsCount} 秒`);
            
            if (repsCount >= 4) {
              repStatus.textContent = "達標";
              repStatus.style.color = "var(--vintage-green)";
            }
          }
        } else {
          stableFrames = 0;
          repStatus.textContent = "未達標";
          repStatus.style.color = "var(--vintage-red)";
        }
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">左臂伸直度</span>
            <span class="metric-val">${Math.round(leftArmStraight)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">右臂伸直度</span>
            <span class="metric-val">${Math.round(rightArmStraight)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">高舉過頭</span>
            <span class="metric-val">${isLeftUp && isRightUp ? "是" : "否"}</span>
          </div>
        `;
        
      } else if (activeIndex === 3) {
        // 腰部扭轉
        const shoulderWidth = Math.abs(rs.x - ls.x);
        const hipWidth = Math.abs(rh.x - lh.x);
        
        const currentRatio = shoulderWidth / Math.max(hipWidth, 0.01);
        const twistAngle = calculateAngleFromRatio(shoulderWidth, hipWidth);
        
        angleBuffer.push(twistAngle);
        ratioBuffer.push(currentRatio);
        if (angleBuffer.length > BUFFER_MAX) angleBuffer.shift();
        if (ratioBuffer.length > BUFFER_MAX) ratioBuffer.shift();
        
        const avgAngle = angleBuffer.reduce((a, b) => a + b, 0) / angleBuffer.length;
        const avgRatio = ratioBuffer.reduce((a, b) => a + b, 0) / ratioBuffer.length;
        
        if (avgRatio < 0.70 && repState === "neutral") {
          repState = "underway";
          repStatus.textContent = "扭轉中";
          repStatus.style.color = "var(--vintage-yellow)";
          if (timeSec - lastRepTime > 2.0) speakText("轉體");
        } else if (repState === "underway" && avgRatio > 0.92) {
          if (timeSec - lastRepTime > 1.0) {
            repsCount++;
            updateRepDisplay();
            lastRepTime = timeSec;
            repState = "neutral";
            repStatus.textContent = "回正";
            repStatus.style.color = "var(--vintage-green)";
            if (chkSfx.checked) Synth.playTick();
            speakText(`第 ${repsCount} 下`);
          }
        }
        
        let scorePart = 100;
        if (avgAngle < 30) {
          scorePart -= Math.min(30, (30 - avgAngle) * 3);
          currentFeedback.push("請加大左右扭轉腰部的幅度");
          currentPerfect = false;
        } else if (avgAngle > 60) {
          scorePart -= 15;
          currentFeedback.push("幅度過大，注意重心穩定");
          currentPerfect = false;
        }
        
        const leftKneeAngle = calculateAngle(lh, lk, la);
        const rightKneeAngle = calculateAngle(rh, rk, ra);
        const avgKnee = (leftKneeAngle + rightKneeAngle) / 2;
        if (avgKnee < 150) {
          scorePart -= 20;
          currentFeedback.push("雙腿不應過度彎曲，保持微彎微站直");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">扭轉角度</span>
            <span class="metric-val">${avgAngle.toFixed(1)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">肩/臀寬比</span>
            <span class="metric-val">${avgRatio.toFixed(2)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">雙膝夾角</span>
            <span class="metric-val">${Math.round(avgKnee)}°</span>
          </div>
        `;
        
      } else if (activeIndex === 4) {
        // 體側彎
        const dx = shoulderCenter.x - hipCenter.x;
        const dy = shoulderCenter.y - hipCenter.y;
        const bendAngle = Math.atan2(Math.abs(dx), Math.abs(dy)) * (180.0 / Math.PI);
        
        let sideLabel = "直立";
        if (bendAngle >= 10) {
          sideLabel = dx > 0 ? "向右側彎" : "向左側彎";
        }
        
        const hipShift = Math.abs(hipCenter.x - feetCenter.x);
        
        let isArmRaised = false;
        if (sideLabel === "向右側彎") {
          if (lw.y < ls.y) isArmRaised = true;
        } else if (sideLabel === "向左側彎") {
          if (rw.y < rs.y) isArmRaised = true;
        }
        
        let scorePart = 100;
        if (bendAngle < 22) {
          if (bendAngle >= 8) {
            scorePart -= Math.min(30, (22 - bendAngle) * 2.5);
            currentFeedback.push("側彎幅度不夠，請再往側邊壓");
          } else {
            scorePart -= 40;
            currentFeedback.push("請將身體向左或向右側彎下壓");
          }
          currentPerfect = false;
        }
        
        if (sideLabel !== "直立" && !isArmRaised) {
          scorePart -= 25;
          currentFeedback.push(sideLabel === "向右側彎" ? "請將左手臂高舉過頭" : "請將右手臂高舉過頭");
          currentPerfect = false;
        }
        
        if (hipShift > 0.08) {
          scorePart -= 20;
          currentFeedback.push("骨盆請保持在中線，不要往兩側頂出");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        const isPoseCorrect = (currentScore >= 80 && bendAngle >= 22);
        if (isPoseCorrect) {
          stableFrames++;
          repStatus.textContent = `Hold: ${stableFrames}/15`;
          repStatus.style.color = "var(--vintage-yellow)";
          
          if (stableFrames === 15) {
            repsCount++;
            updateRepDisplay();
            repStatus.textContent = "達標 (PASS)";
            repStatus.style.color = "var(--vintage-green)";
            if (chkSfx.checked) Synth.playTick();
            speakText(`體側彎達標，第 ${repsCount} 下`);
          }
        } else {
          stableFrames = 0;
          repStatus.textContent = sideLabel;
          repStatus.style.color = "var(--vintage-ink)";
        }
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">側彎角度</span>
            <span class="metric-val">${bendAngle.toFixed(1)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">側彎方向</span>
            <span class="metric-val">${sideLabel}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">骨盆偏移</span>
            <span class="metric-val">${hipShift.toFixed(3)}</span>
          </div>
        `;
        
      } else if (activeIndex === 5) {
        // 體前彎
        const forwardBendAngle = calculateAngle(shoulderCenter, hipCenter, feetCenter);
        const leftKneeAngle = calculateAngle(lh, lk, la);
        const rightKneeAngle = calculateAngle(rh, rk, ra);
        const avgKnee = (leftKneeAngle + rightKneeAngle) / 2;
        
        const leftWristY = lw.y;
        const rightWristY = rw.y;
        const hipY = hipCenter.y;
        const isHandsDown = (leftWristY > hipY + 0.12 && rightWristY > hipY + 0.12);
        
        let scorePart = 100;
        if (forwardBendAngle > 120) {
          scorePart -= Math.min(40, (forwardBendAngle - 120) * 1.5);
          currentFeedback.push("上半身請盡量向前彎曲，手向下摸");
          currentPerfect = false;
        }
        
        if (!isHandsDown) {
          scorePart -= 25;
          currentFeedback.push("請雙手自然下垂，伸向地面");
          currentPerfect = false;
        }
        
        if (avgKnee < 145) {
          scorePart -= 20;
          currentFeedback.push("膝蓋請盡量伸直，不要大幅度彎曲");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        const isPoseCorrect = (currentScore >= 80 && forwardBendAngle < 120);
        if (isPoseCorrect) {
          stableFrames++;
          repStatus.textContent = `Hold: ${stableFrames}/15`;
          repStatus.style.color = "var(--vintage-yellow)";
          
          if (stableFrames === 15) {
            repsCount++;
            updateRepDisplay();
            repStatus.textContent = "前彎達標";
            repStatus.style.color = "var(--vintage-green)";
            if (chkSfx.checked) Synth.playTick();
            speakText(`前彎達標，第 ${repsCount} 下`);
          }
        } else {
          stableFrames = 0;
          repStatus.textContent = "直立";
          repStatus.style.color = "var(--vintage-ink)";
        }
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">前彎髖夾角</span>
            <span class="metric-val">${Math.round(forwardBendAngle)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">雙膝夾角</span>
            <span class="metric-val">${Math.round(avgKnee)}°</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">手腕下探</span>
            <span class="metric-val">${isHandsDown ? "是" : "否"}</span>
          </div>
        `;
        
      } else if (activeIndex === 6) {
        // 四肢伸展
        const hipWidth = Math.abs(rh.x - lh.x);
        const feetWidth = Math.abs(ra.x - la.x);
        const feetRatio = feetWidth / Math.max(hipWidth, 0.01);
        
        const leftWristToShoulderX = ls.x - lw.x;
        const rightWristToShoulderX = rw.x - rs.x;
        const leftArmStraight = calculateAngle(lh, le, lw);
        const rightArmStraight = calculateAngle(rh, re, rw);
        
        const isLeftArmWide = (leftWristToShoulderX > 0.12 && lw.y < ls.y + 0.05);
        const isRightArmWide = (rightWristToShoulderX > 0.12 && rw.y < rs.y + 0.05);
        
        let scorePart = 100;
        if (feetRatio < 1.35) {
          scorePart -= Math.min(30, (1.35 - feetRatio) * 100);
          currentFeedback.push("雙腳請往左右跨開，站寬一點");
          currentPerfect = false;
        }
        
        if (!isLeftArmWide || !isRightArmWide) {
          scorePart -= 30;
          currentFeedback.push("雙手向左右斜上方張開呈大字形");
          currentPerfect = false;
        }
        
        if (leftArmStraight < 155 || rightArmStraight < 155) {
          scorePart -= 15;
          currentFeedback.push("手臂手肘請盡量伸直");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        const isPoseCorrect = (currentScore >= 80);
        if (isPoseCorrect) {
          stableFrames++;
          repStatus.textContent = `Hold: ${stableFrames}/15`;
          repStatus.style.color = "var(--vintage-yellow)";
          
          if (stableFrames === 15) {
            repsCount++;
            updateRepDisplay();
            repStatus.textContent = "大字伸展";
            repStatus.style.color = "var(--vintage-green)";
            if (chkSfx.checked) Synth.playTick();
            speakText(`大字伸展完成`);
          }
        } else {
          stableFrames = 0;
          repStatus.textContent = "未達標";
          repStatus.style.color = "var(--vintage-ink)";
        }
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">跨步寬度比</span>
            <span class="metric-val">${feetRatio.toFixed(2)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">雙手大張</span>
            <span class="metric-val">${isLeftArmWide && isRightArmWide ? "是" : "否"}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">手肘伸直度</span>
            <span class="metric-val">${Math.round((leftArmStraight+rightArmStraight)/2)}°</span>
          </div>
        `;
        
      } else if (activeIndex === 7) {
        // 深呼吸
        const avgWristY = (lw.y + rw.y) / 2;
        const hipY = hipCenter.y;
        const shoulderY = shoulderCenter.y;
        
        if (breathCycleState === "exhale-done" && avgWristY < hipY - 0.1) {
          breathCycleState = "inhaling";
          repStatus.textContent = "吸氣中...";
          repStatus.style.color = "var(--vintage-yellow)";
          speakText("緩慢吸氣");
        } else if (breathCycleState === "inhaling" && avgWristY < shoulderY + 0.1) {
          breathCycleState = "inhale-done";
          repStatus.textContent = "吸飽氣";
          repStatus.style.color = "var(--vintage-yellow)";
        } else if (breathCycleState === "inhale-done" && avgWristY > shoulderY + 0.1) {
          breathCycleState = "exhaling";
          repStatus.textContent = "吐氣中...";
          repStatus.style.color = "var(--vintage-yellow)";
          speakText("徐徐吐氣");
        } else if (breathCycleState === "exhaling" && avgWristY > hipY - 0.1) {
          breathCycleState = "exhale-done";
          repsCount++;
          updateRepDisplay();
          repStatus.textContent = "呼吸平穩";
          repStatus.style.color = "var(--vintage-green)";
          if (chkSfx.checked) Synth.playTick();
          speakText(`深呼吸第 ${repsCount} 次`);
        }
        
        const hipTilt = Math.abs(lh.y - rh.y);
        const shoulderTilt = Math.abs(ls.y - rs.y);
        const bodyShiftX = Math.abs(shoulderCenter.x - feetCenter.x);
        
        let scorePart = 100;
        if (hipTilt > 0.07 || shoulderTilt > 0.07) {
          scorePart -= 15;
          currentFeedback.push("深呼吸時，肩膀請保持水平");
          currentPerfect = false;
        }
        if (bodyShiftX > 0.07) {
          scorePart -= 15;
          currentFeedback.push("身體請勿前後或左右晃動");
          currentPerfect = false;
        }
        
        currentScore = Math.max(10, Math.round(scorePart));
        
        metricsHTML = `
          <div class="metric-item">
            <span class="metric-lbl">手腕 Y 座標</span>
            <span class="metric-val">${avgWristY.toFixed(2)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">肩膀水平</span>
            <span class="metric-val">${shoulderTilt.toFixed(3)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-lbl">中軸位移</span>
            <span class="metric-val">${bodyShiftX.toFixed(3)}</span>
          </div>
        `;
      }
      
      cachedState.score = currentScore;
      cachedState.feedback = currentFeedback;
      cachedState.perfect = currentPerfect;

      // 收集分數做加權平均
      currentSessionScores.push(currentScore);
      
      // ================= 全套模式 (Routine Mode) 通關自動跳轉邏輯 =================
      const targetReps = (activeIndex === 7) ? 3 : 4;
      if (workoutMode === "routine" && repsCount >= targetReps) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        
        if (chkSfx.checked) Synth.playSuccessChime();
        
        // 標記郵票合格
        const activeStamp = document.querySelector(`.stamp-item[data-index="${activeIndex}"]`);
        if (activeStamp) {
          activeStamp.classList.add("completed");
          activeStamp.querySelector(".stamp-status").textContent = "合格";
        }
        
        // 暫存此小節紀錄到全套陣列
        submitWorkoutSession(activeIndex === 7);

        if (activeIndex < 7) {
          // 下一小節過渡倒數
          const nextIndex = activeIndex + 1;
          
          countdownTitle.textContent = `第 ${EXERCISES[activeIndex].numStr} 節 ${EXERCISES[activeIndex].name} 完成！`;
          document.querySelector(".countdown-next-lbl").textContent = `準備下一節：${EXERCISES[nextIndex].name}`;
          countdownTimer.textContent = "3";
          countdownOverlay.classList.remove("hidden");
          
          speakText(`完成第 ${EXERCISES[activeIndex].numStr} 節，做得很好！準備下一節：${EXERCISES[nextIndex].name}`);
          
          let count = 3;
          const timerId = setInterval(() => {
            count--;
            countdownTimer.textContent = count;
            if (chkSfx.checked) Synth.playCountdown();
            
            if (count === 0) {
              clearInterval(timerId);
              countdownOverlay.classList.add("hidden");
              
              // 切換動作
              selectExercise(nextIndex);
              
              lastFpsTime = performance.now();
              frameCount = 0;
              animationFrameId = requestAnimationFrame(detectionLoop);
            }
          }, 1000);
          
        } else {
          // 八節全套套操全部通關！
          countdownTitle.textContent = "🎉 恭喜全部完成！";
          document.querySelector(".countdown-next-lbl").textContent = "第一代國民健康操．強身健國！";
          countdownTimer.textContent = "優";
          countdownOverlay.classList.remove("hidden");
          speakText("恭喜完成全套第一代國民健康操！強身健體，精神飽滿！");
          
          setTimeout(() => {
            countdownOverlay.classList.add("hidden");
            const stamps = document.querySelectorAll(".stamp-item");
            stamps.forEach(s => {
              s.classList.remove("completed");
              s.querySelector(".stamp-status").textContent = "待命";
            });
            selectExercise(0);
            
            lastFpsTime = performance.now();
            frameCount = 0;
            animationFrameId = requestAnimationFrame(detectionLoop);
          }, 5000);
        }
        
        return;
      }
    }
  } else {
    cachedState.landmarks = null;
  }

  // ================= 繪圖渲染與 UI 面板更新 =================
  updateOSDUI(metricsHTML);
  drawSkeletonOverlay(w, h);
  
  if (animationFrameId) {
    animationFrameId = requestAnimationFrame(detectionLoop);
  }
}

// ================= UI 更新 =================
function updateOSDUI(metricsHTML) {
  scoreDisplay.textContent = cachedState.score;
  scoreBar.style.width = `${cachedState.score}%`;
  
  if (cachedState.score >= 85) {
    scoreDisplay.className = "led-num text-glow-green";
    scoreBar.style.background = "linear-gradient(90deg, #16a34a, #4ade80)";
  } else if (cachedState.score >= 60) {
    scoreDisplay.className = "led-num text-glow-blue";
    scoreBar.style.background = "linear-gradient(90deg, #2563eb, #60a5fa)";
  } else {
    scoreDisplay.className = "led-num";
    scoreDisplay.style.color = "var(--vintage-red)";
    scoreDisplay.style.textShadow = "0 0 10px rgba(168, 42, 37, 0.7)";
    scoreBar.style.background = "linear-gradient(90deg, #b91c1c, #f87171)";
  }
  
  if (cachedState.perfect && cachedState.landmarks) {
    posePerfectBadge.classList.add("visible");
  } else {
    posePerfectBadge.classList.remove("visible");
  }

  if (!cachedState.landmarks) {
    feedbackList.innerHTML = `<div class="feedback-placeholder">電子管正常，未捕捉到人體骨骼，請站到鏡頭前...</div>`;
  } else if (cachedState.feedback.length === 0) {
    feedbackList.innerHTML = `
      <div class="feedback-alert success">
        姿勢相當端正！請保持規律做操！
      </div>
    `;
  } else {
    feedbackList.innerHTML = cachedState.feedback
      .map(msg => `<div class="feedback-alert warning">${msg}</div>`)
      .join("");
  }
  
  if (metricsHTML) {
    metricsContainer.innerHTML = metricsHTML;
  } else {
    metricsContainer.innerHTML = `<div class="metric-placeholder">等待骨骼分析資料...</div>`;
  }
  
  const currentStampStatus = document.querySelector(`.stamp-item[data-index="${activeIndex}"] .stamp-status`);
  if (currentStampStatus) {
    if (workoutMode === "routine") {
      const target = (activeIndex === 7) ? 3 : 4;
      currentStampStatus.textContent = `${repsCount}/${target} 下`;
    } else {
      currentStampStatus.textContent = `${repsCount} 下`;
    }
  }
}

// 繪製骨架 Canvas (發光骨節殘影)
function drawSkeletonOverlay(canvasW, canvasH) {
  const lm = cachedState.landmarks;
  if (!lm) return;
  
  const connections = [
    [LS_ID, RS_ID], [LS_ID, LH_ID], [RS_ID, RH_ID], [LH_ID, RH_ID],
    [LS_ID, LE_ID], [LE_ID, LW_ID],
    [RS_ID, RE_ID], [RE_ID, RW_ID],
    [LH_ID, LK_ID], [LK_ID, LA_ID],
    [RH_ID, RK_ID], [RK_ID, RA_ID]
  ];
  
  const isMirror = chkMirror.checked;
  const drawPt = (pt) => {
    let x = pt.x * canvasW;
    let y = pt.y * canvasH;
    if (isMirror) {
      x = canvasW - x;
    }
    return { x, y };
  };
  
  ctx.strokeStyle = "#39ff14";
  ctx.lineWidth = 4;
  ctx.shadowBlur = 8;
  ctx.shadowColor = "#39ff14";
  ctx.lineCap = "round";
  
  connections.forEach(([p1, p2]) => {
    const pt1 = drawPt(lm[p1]);
    const pt2 = drawPt(lm[p2]);
    
    ctx.beginPath();
    ctx.moveTo(pt1.x, pt1.y);
    ctx.lineTo(pt2.x, pt2.y);
    ctx.stroke();
  });
  
  ctx.fillStyle = "#ffffff";
  ctx.shadowBlur = 12;
  ctx.shadowColor = "#39ff14";
  
  const drawJoints = [LS_ID, RS_ID, LE_ID, RE_ID, LW_ID, RW_ID, LH_ID, RH_ID, LK_ID, RK_ID, LA_ID, RA_ID];
  drawJoints.forEach(id => {
    const pt = drawPt(lm[id]);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI);
    ctx.fill();
  });
  
  ctx.shadowBlur = 0;
}

// ================= SVG 示範火柴人動態更新 =================
function updatePoseSvg(idx) {
  let svgContent = "";
  const colors = `stroke="var(--vintage-ink)" stroke-width="4" stroke-linecap="round" fill="none"`;
  const guides = `stroke="var(--vintage-red)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="2.5, 2.5" fill="none"`;
  
  if (idx === 0) {
    svgContent = `
      <circle cx="45" cy="30" r="7" fill="var(--vintage-ink)" />
      <line x1="45" y1="37" x2="35" y2="58" ${colors} />
      <line x1="35" y1="58" x2="60" y2="65" ${colors} />
      <line x1="60" y1="65" x2="50" y2="85" ${colors} />
      <line x1="43" y1="41" x2="78" y2="41" ${colors} />
      <path d="M 68,52 A 18,18 0 0,1 68,75" ${guides} />
      <path d="M 68,75 L 63,73 M 68,75 L 67,69" ${guides} />
      <path d="M 38,58 A 12,12 0 0,1 55,62" ${guides} />
    `;
  } else if (idx === 1) {
    svgContent = `
      <circle cx="50" cy="24" r="7" fill="var(--vintage-ink)" />
      <line x1="50" y1="31" x2="50" y2="52" ${colors} />
      <path d="M 50,52 L 35,66 L 43,85" ${colors} />
      <path d="M 50,52 L 65,66 L 57,85" ${colors} />
      <path d="M 45,36 L 34,44 L 46,52" ${colors} />
      <path d="M 55,36 L 66,44 L 54,52" ${colors} />
      <path d="M 28,66 Q 34,74 38,66" ${guides} />
      <path d="M 72,66 Q 66,74 62,66" ${guides} />
    `;
  } else if (idx === 2) {
    svgContent = `
      <circle cx="50" cy="28" r="7" fill="var(--vintage-ink)" />
      <line x1="50" y1="35" x2="50" y2="60" ${colors} />
      <line x1="50" y1="60" x2="40" y2="85" ${colors} />
      <line x1="50" y1="60" x2="60" y2="85" ${colors} />
      <line x1="43" y1="39" x2="40" y2="12" ${colors} />
      <line x1="57" y1="39" x2="60" y2="12" ${colors} />
      <line x1="32" y1="30" x2="32" y2="12" ${guides} />
      <line x1="32" y1="12" x2="29" y2="17" ${guides} />
      <line x1="32" y1="12" x2="35" y2="17" ${guides} />
      <line x1="68" y1="30" x2="68" y2="12" ${guides} />
      <line x1="68" y1="12" x2="65" y2="17" ${guides} />
      <line x1="68" y1="12" x2="71" y2="17" ${guides} />
    `;
  } else if (idx === 3) {
    svgContent = `
      <circle cx="50" cy="24" r="7" fill="var(--vintage-ink)" />
      <line x1="50" y1="31" x2="50" y2="58" ${colors} />
      <line x1="50" y1="58" x2="42" y2="85" ${colors} />
      <line x1="50" y1="58" x2="58" y2="85" ${colors} />
      <path d="M 45,35 Q 25,35 40,43" ${colors} />
      <line x1="55" y1="35" x2="80" y2="35" ${colors} />
      <path d="M 32,48 Q 50,56 68,48" ${guides} />
      <path d="M 68,48 L 62,47 M 68,48 L 65,52" ${guides} />
    `;
  } else if (idx === 4) {
    svgContent = `
      <circle cx="44" cy="24" r="7" fill="var(--vintage-ink)" />
      <path d="M 44,31 Q 52,48 50,60" ${colors} />
      <line x1="50" y1="60" x2="42" y2="85" ${colors} />
      <line x1="50" y1="60" x2="58" y2="85" ${colors} />
      <path d="M 40,34 Q 28,15 48,12" ${colors} />
      <path d="M 48,36 L 56,44 L 50,50" ${colors} />
      <path d="M 60,14 A 32,32 0 0,0 48,34" ${guides} />
      <path d="M 48,34 L 47,28 M 48,34 L 53,32" ${guides} />
    `;
  } else if (idx === 5) {
    svgContent = `
      <circle cx="34" cy="62" r="7" fill="var(--vintage-ink)" />
      <line x1="34" y1="55" x2="55" y2="48" ${colors} />
      <line x1="55" y1="48" x2="55" y2="85" ${colors} />
      <line x1="55" y1="48" x2="63" y2="85" ${colors} />
      <line x1="42" y1="52" x2="33" y2="80" ${colors} />
      <path d="M 36,44 Q 22,60 25,75" ${guides} />
      <path d="M 25,75 L 21,71 M 25,75 L 29,73" ${guides} />
    `;
  } else if (idx === 6) {
    svgContent = `
      <circle cx="50" cy="24" r="7" fill="var(--vintage-ink)" />
      <line x1="50" y1="31" x2="50" y2="52" ${colors} />
      <line x1="50" y1="52" x2="30" y2="85" ${colors} />
      <line x1="50" y1="52" x2="70" y2="85" ${colors} />
      <line x1="44" y1="35" x2="20" y2="20" ${colors} />
      <line x1="56" y1="35" x2="80" y2="20" ${colors} />
      <path d="M 28,29 Q 18,34 23,40" ${guides} />
      <path d="M 72,29 Q 82,34 77,40" ${guides} />
    `;
  } else if (idx === 7) {
    svgContent = `
      <circle cx="50" cy="24" r="7" fill="var(--vintage-ink)" />
      <line x1="50" y1="31" x2="50" y2="58" ${colors} />
      <line x1="50" y1="58" x2="44" y2="85" ${colors} />
      <line x1="50" y1="58" x2="56" y2="85" ${colors} />
      <path d="M 44,35 Q 26,42 42,54" ${colors} />
      <path d="M 56,35 Q 74,42 58,54" ${colors} />
      <path d="M 40,24 Q 36,23 32,24 M 40,26 Q 35,27 31,28" ${guides} />
      <path d="M 60,24 Q 64,23 68,24 M 60,26 Q 65,27 69,28" ${guides} />
    `;
  }
  poseSvg.innerHTML = svgContent;
}

// ================= 事件綁定與監聽 =================
function bindEvents() {
  btnToggleCamera.addEventListener("click", toggleCamera);
  
  // 鏡像開關
  chkMirror.addEventListener("change", () => {
    if (chkMirror.checked) {
      webcamElement.classList.add("mirror-y");
    } else {
      webcamElement.classList.remove("mirror-y");
    }
  });

  // 模式按鈕切換
  modeRoutine.addEventListener("click", () => {
    workoutMode = "routine";
    modeRoutine.classList.add("active");
    modeSingle.classList.remove("active");
    osdWorkoutMode.textContent = "全套練習";
    resetReps();
    selectExercise(0); // 自動跳到第一小節開始
  });

  modeSingle.addEventListener("click", () => {
    workoutMode = "single";
    modeSingle.classList.add("active");
    modeRoutine.classList.remove("active");
    osdWorkoutMode.textContent = "單節訓練";
    resetReps();
  });
  
  // 點擊郵票切換動作 (自主模式下可切換)
  const stamps = document.querySelectorAll(".stamp-item");
  stamps.forEach(stamp => {
    stamp.addEventListener("click", () => {
      if (workoutMode === "single") {
        const idx = parseInt(stamp.getAttribute("data-index"), 10);
        selectExercise(idx);
      } else {
        speakText("全套模式下無法手動切換小節，請完成各節計數");
      }
    });
  });

  // 資料庫做操運動員選取切換
  athleteSelect.addEventListener("change", (e) => {
    currentUserId = e.target.value;
    loadAthleteHistory(currentUserId);
  });

  // 註冊運動員按鈕
  btnAddAthlete.addEventListener("click", registerAthlete);
  newAthleteInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") registerAthlete();
  });
}

// ================= 主載入點 =================
window.addEventListener("DOMContentLoaded", () => {
  chkMirror.checked = true;
  webcamElement.classList.add("mirror-y");
  
  // 綁定 DOM 事件
  bindEvents();
  
  // 載入預設動作 (第一節：深蹲)
  selectExercise(0);
  
  // 從後端資料庫載入運動員清單
  loadAthletes();
  
  // 載入 MediaPipe 引擎
  initPoseModel();
});
