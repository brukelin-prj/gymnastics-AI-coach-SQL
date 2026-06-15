// --- 前端核心控制與 AI 判定邏輯 (app.js - 獨立小節重構版) ---

// --- 狀態機定義 ---
const STATE_LOGIN = 'login';
const STATE_MENU = 'menu';
const STATE_WORKOUT = 'workout';
let currentAppState = STATE_LOGIN;
let workoutMode = 'routine'; // 'routine' (全套連續做) 或 'single' (單節加強練)

// --- 全域變數 ---
let currentUser = null;
let currentStageIndex = 0; // 當前所選節次 (0-8)
let currentScore = 0;
let currentBeat = 0;
let currentSection = 1;
let currentProgressBeat = 0; // 全域節拍進度

// 儲存當前小節的得分與偵測次數，用於計算該小節平均分數
let stageScores = [];
let stageStartTime = 0;

// 評分平滑化與更新頻率限制
let smoothedMatchPct = 0;
let lastUiUpdateTime = 0;

// 自適應 AI 閥值 (從後端獲取，預設寬鬆值)
let configThresholds = {
    squat_tolerance: 15.0,
    arm_tolerance: 15.0,
    twist_tolerance: 15.0
};

// 8式動作名稱與指引
const STAGES = [
    { 
        name: "預備動作", 
        camera: "正面", 
        desc: "原地踏步，雙手握拳，屈肘隨節奏自然擺動，維持身體直立，跟隨 60 BPM 節拍預備起！",
        criteria: [
            "雙手握拳，屈肘自然擺動",
            "原地踏步，維持 60 BPM 節奏"
        ]
    },
    { 
        name: "第一節：下肢全深蹲", 
        camera: "側面", 
        desc: "請側身站立。雙腳與肩同寬，手向前平舉，臀部向後坐深蹲。膝蓋彎曲接近 90 度，重心在後腳跟，避免膝蓋過度前傾。",
        criteria: [
            "下蹲時膝蓋夾角需小於 100°",
            "雙手需向前平舉 (手肘夾角 > 150°)",
            "重心偏移小於 30px (臀部與腳踝水平對位)"
        ]
    },
    { 
        name: "第二節：下肢半深蹲", 
        camera: "側面", 
        desc: "請正面站立。雙腳張開比肩略寬，雙手插腰，膝蓋微彎下蹲，大腿與小腿夾角約 120-140 度。保持身體直立，骨盆不要傾斜。",
        criteria: [
            "正面站立 (肩寬 X 差距大於寬度 15%)",
            "膝蓋微彎 (夾角在 110° - 140° 之間)",
            "雙手插腰 (手腕接近臀部高度)"
        ]
    },
    { 
        name: "第三節：上肢向上伸展", 
        camera: "正面", 
        desc: "請正面站立。雙手從身體兩側向上伸直高舉過頭，掌心相對。手臂貼近耳朵，保持身體中軸直立，雙腿伸直不彎曲。",
        criteria: [
            "雙手腕需高於肩膀 (Wrist Y < Shoulder Y)",
            "手臂需伸直 (手肘夾角 > 155°)",
            "身體中軸直立 (兩肩與兩髖維持水平)"
        ]
    },
    { 
        name: "第四節：擴胸轉體", 
        camera: "正面", 
        desc: "請正面站立。雙手插腰或平舉，以腰部為軸心進行左右扭轉。骨盆保持朝前穩定，利用胸腔與肩膀的旋轉帶動動作。",
        criteria: [
            "旋轉幅度需達標 (肩寬/臀寬比例 < 0.70)",
            "骨盆維持水平穩定，避免隨之大晃動",
            "膝蓋保持微彎但不左右搖擺"
        ]
    },
    { 
        name: "第五節：體側左右彎曲", 
        camera: "正面", 
        desc: "請正面站立。單手高舉過頭，另一手插腰，身體朝著插腰的一側側彎。側邊肌肉伸展，骨盆維持中軸不左右滑動。",
        criteria: [
            "身體側彎角度需大於 22°",
            "上舉之手臂手腕高於肩膀且高舉過頭",
            "骨盆左右偏移 (Hip Shift) 小於 0.08"
        ]
    },
    { 
        name: "第六節：前後彎體", 
        camera: "側面", 
        desc: "請正面站立。雙手自然下垂，上半身向前彎曲，臀部向後，雙手盡量往下摸到腳趾或地板，雙膝儘量保持伸直不彎曲。",
        criteria: [
            "上半身向前下彎 (髖關節角度 < 120°)",
            "手腕低於臀部高度 (Wrist Y > Hip Y + 0.15)",
            "雙膝伸直 (膝蓋夾角 > 150°)"
        ]
    },
    { 
        name: "第七節：四肢協調伸展", 
        camera: "正面", 
        desc: "請正面站立。雙腳向兩側跨開（寬於臀部的 1.35 倍），雙手向兩側斜上方張開呈大字形。全身大張伸展，四肢關節伸直。",
        criteria: [
            "雙腳大張 (踝距 > 1.35 * 臀寬)",
            "雙手朝兩側斜上張開 (手腕高於肩，兩腕寬度大)",
            "肘關節與膝關節完全伸直"
        ]
    },
    { 
        name: "第八節：呼吸整理運動", 
        camera: "正面", 
        desc: "請正面站立。配合節奏，吸氣時雙手由下往上緩慢抬起，胸腔擴張；吐氣時雙手緩慢放下，全身放鬆，調節呼吸至平穩。",
        criteria: [
            "吸氣：雙手腕緩慢上升至高於肩膀",
            "吐氣：雙手腕緩慢下降至低於髖部",
            "呼吸循環頻率需緩慢穩定 (一次約 3-4 秒)"
        ]
    }
];

// --- 幾何工具函式 ---
function getAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 180;
    
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
    
    const dotProduct = v1.x * v2.x + v1.y * v2.y;
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    if (len1 === 0 || len2 === 0) return 180;
    
    const cosAngle = Math.max(-1.0, Math.min(1.0, dotProduct / (len1 * len2)));
    const angle = Math.acos(cosAngle);
    return angle * (180 / Math.PI); // 回傳 0-180 度
}

// --- DOM 元素 ---
const authModal = document.getElementById("auth-modal");
const tvDoors = document.getElementById("tv-doors");
const powerLed = document.getElementById("power-led");

// 螢幕容器切換
const tvMenuScreen = document.getElementById("tv-menu-screen");
const tvWorkoutScreen = document.getElementById("tv-workout-screen");
const btnBackToMenu = document.getElementById("btn-back-to-menu");
const workoutBeatProgress = document.getElementById("workout-beat-progress");

// LED 儀表板與回饋
const ledStage = document.getElementById("led-stage");
const ledActionName = document.getElementById("led-action-name");
const ledMatchPct = document.getElementById("led-match-pct");
const ledScore = document.getElementById("led-score");
const ledCamDir = document.getElementById("led-cam-dir");
const feedbackText = document.getElementById("feedback-text");
const feedbackSmiley = document.getElementById("feedback-smiley");
const matchBar = document.getElementById("match-bar");
const poseWarning = document.getElementById("pose-warning");

// 畫布與影像
const videoElement = document.getElementById("webcam");
const canvasPlayer = document.getElementById("canvas-player");
const ctxPlayer = canvasPlayer.getContext("2d");
const canvasCoach = document.getElementById("canvas-coach");
const ctxCoach = canvasCoach.getContext("2d");

// 旋鈕
const knobChannel = document.getElementById("knob-channel");
const knobVolume = document.getElementById("knob-volume");

// --- 初始化 MediaPipe Pose 與 Camera (動態建立/銷毀) ---
let pose = null;
let camera = null;
let isTVOn = false;
let lastFrameTime = 0;

function initPoseDetection() {
    console.log("Dynamically initializing MediaPipe Pose Engine...");
    pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    pose.setOptions({
        modelComplexity: 0, // 0: Lite 模式，極低 RAM 佔用，適合低階行動端
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    pose.onResults(onPoseResults);
}

// --- 會員系統對接 (FastAPI API) ---
const API_BASE = ""; // 本地相對路徑

// 動態讀取與載入本地註冊過的使用者歷史至 datalist
function populateUserDatalist() {
    const datalist = document.getElementById("registered-usernames");
    if (!datalist) return;
    datalist.innerHTML = "";
    
    let savedUsers = [];
    try {
        const raw = localStorage.getItem("retro_gym_saved_users");
        if (raw) savedUsers = JSON.parse(raw);
    } catch (e) {
        console.error("讀取歷史使用者帳號失敗:", e);
    }
    
    savedUsers.forEach(username => {
        const option = document.createElement("option");
        option.value = username;
        datalist.appendChild(option);
    });
}

// 儲存帳號至本地歷史
function saveUserToHistory(username) {
    try {
        let savedUsers = [];
        const raw = localStorage.getItem("retro_gym_saved_users");
        if (raw) savedUsers = JSON.parse(raw);
        
        if (!savedUsers.includes(username)) {
            savedUsers.push(username);
            localStorage.setItem("retro_gym_saved_users", JSON.stringify(savedUsers));
        }
        populateUserDatalist();
    } catch (e) {
        console.error("儲存使用者至歷史失敗:", e);
    }
}

// 點擊登入/開始按鈕
document.getElementById("btn-auth-submit").addEventListener("click", async () => {
    const usernameInput = document.getElementById("auth-username");
    const username = usernameInput.value.trim();
    if (!username) {
        alert("請輸入帳號！");
        return;
    }
    
    // 如果註冊面板已展開，執行註冊，否則先嘗試登入
    const registerFields = document.getElementById("auth-register-fields");
    const isRegisterMode = !registerFields.classList.contains("hidden");
    
    // 預設密碼為 username + "_pass"
    const dummyPassword = username + "_pass";
    
    if (isRegisterMode) {
        // 註冊模式
        const age = parseInt(document.getElementById("auth-age").value) || 25;
        const gender = document.getElementById("auth-gender").value;
        const height = parseFloat(document.getElementById("auth-height").value) || 170;
        const weight = parseFloat(document.getElementById("auth-weight").value) || 65;
        
        try {
            const res = await fetch(`${API_BASE}/api/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password: dummyPassword, age, height, weight, gender })
            });
            const data = await res.json();
            if (res.ok) {
                alert("註冊角色成功！");
                saveUserToHistory(username);
                await performLogin(username, dummyPassword);
            } else {
                alert(`註冊失敗: ${data.detail}`);
            }
        } catch (e) {
            alert("伺服器連線與註冊失敗");
        }
    } else {
        // 登入模式
        const success = await performLogin(username, dummyPassword);
        if (!success) {
            // 登入失敗表示帳號不存在，展開註冊面板
            registerFields.classList.remove("hidden");
            document.getElementById("btn-auth-submit").textContent = "CREATE CHARACTER (註冊並登入)";
            usernameInput.disabled = true; // 鎖定帳號欄位避免修改
        }
    }
});

// 當頁面載入完成時，自動初始化資料列表
document.addEventListener("DOMContentLoaded", () => {
    populateUserDatalist();
});
// 保險起見，若 DOMContentLoaded 已過則直接執行
if (document.readyState !== "loading") {
    populateUserDatalist();
}

async function performLogin(username, password) {
    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            authModal.classList.add("hidden");
            saveUserToHistory(username);
            alert(`歡迎回來，${currentUser.username}！`);
            currentAppState = STATE_MENU;
            loadUserDashboard();
            if (isTVOn) {
                showMenuScreen();
            }
            return true;
        } else {
            return false;
        }
    } catch (e) {
        console.error("伺服器登入驗證失敗:", e);
        return false;
    }
}

// 登入後載入相關統計、動作最高分與動態閾值
async function loadUserDashboard() {
    if (!currentUser) return;
    
    // 初始化 High Scores 顯示
    for (let i = 0; i <= 8; i++) {
        const cardScore = document.getElementById(`high-score-${i}`);
        if (cardScore) cardScore.textContent = "HI: --";
    }

    // 1. 獲取個人歷史紀錄與高分
    try {
        const res = await fetch(`${API_BASE}/api/user_stats?user_id=${currentUser.id}`);
        const data = await res.json();
        if (res.ok) {
            // 更新底部表格
            const tbody = document.getElementById("stats-body");
            tbody.innerHTML = "";
            if (data.summary.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center">尚無運動紀錄，請點選上方卡片開始練習！</td></tr>`;
            } else {
                data.summary.forEach(row => {
                    const tr = document.createElement("tr");
                    tr.innerHTML = `
                        <td>${row.movement_name}</td>
                        <td>${Math.round(row.avg_score)}% (HI: ${Math.round(row.max_score)}%)</td>
                        <td>${row.sessions}次</td>
                        <td>${row.total_duration}秒</td>
                    `;
                    tbody.appendChild(tr);

                    // 同步更新關卡選單上的 High Score (HI)
                    const cardScore = document.getElementById(`high-score-${row.movement_index}`);
                    if (cardScore) {
                        cardScore.textContent = `HI: ${Math.round(row.max_score)}%`;
                    }
                });
            }
        }
    } catch (e) {
        console.error("無法取得歷史統計資料:", e);
    }

    // 2. 獲取自適應 AI 閥值
    try {
        const res = await fetch(`${API_BASE}/api/thresholds?age=${currentUser.age}`);
        const data = await res.json();
        if (res.ok) {
            configThresholds.squat_tolerance = data.squat_tolerance;
            configThresholds.arm_tolerance = data.arm_tolerance;
            configThresholds.twist_tolerance = data.twist_tolerance;
            
            document.getElementById("ai-group").textContent = data.group === "age_60+" ? "長青優化組 (60歲+)" : (data.group === "age_under_18" ? "青春精準組 (<18歲)" : "一般標準組");
            document.getElementById("t-val-squat").textContent = `±${data.squat_tolerance}°`;
            document.getElementById("t-val-arm").textContent = `±${data.arm_tolerance}°`;
            document.getElementById("t-val-twist").textContent = `±${data.twist_tolerance}°`;
        }
    } catch (e) {
        console.error("無法取得自適應閥值:", e);
    }
}

// 分節運動數據上傳
async function uploadStageResult(stageIndex, avgScore) {
    if (!currentUser) return;
    const duration = Math.round((Date.now() - stageStartTime) / 1000);
    try {
        await fetch(`${API_BASE}/api/upload_segment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: currentUser.id,
                movement_index: stageIndex,
                movement_name: STAGES[stageIndex].name,
                match_score: avgScore,
                duration_sec: duration
            })
        });
        console.log(`Uploaded stage ${stageIndex} score: ${avgScore}%`);
        // 上傳後自動重新整理面板的統計與 High Score
        loadUserDashboard();
    } catch (e) {
        console.error("數據上傳失敗", e);
    }
}

// --- 電視開關 (拉門) 與選單切換控制 ---

// 點擊拉門開關 (取代原有電視開關)
tvDoors.addEventListener("click", () => {
    toggleDoors();
});

function toggleDoors() {
    const isOpen = tvDoors.classList.toggle("open");
    isTVOn = isOpen;
    
    if (isTVOn) {
        powerLed.classList.add("on");
        document.getElementById("main-screen").style.filter = "none";
        
        // 自動載入/搜尋開啟相機與初始化模型
        if (!pose) {
            initPoseDetection();
        }
        startWebcam();
        
        // 如果使用者尚未登入，顯示登入彈窗
        if (!currentUser) {
            currentAppState = STATE_LOGIN;
            authModal.classList.remove("hidden");
            // 重置登入欄位
            document.getElementById("auth-username").disabled = false;
            document.getElementById("auth-username").value = "";
            document.getElementById("auth-register-fields").classList.add("hidden");
            document.getElementById("btn-auth-submit").textContent = "PRESS START (登入/開始)";
        } else {
            showMenuScreen();
        }
    } else {
        powerLed.classList.remove("on");
        document.getElementById("main-screen").style.filter = "brightness(0) contrast(0)";
        
        // 關閉拉門時，停止所有練習並關閉鏡頭釋放資源 (進行 fullRelease)
        stopWorkoutAndRelease(true);
        tvMenuScreen.classList.add("hidden");
        tvWorkoutScreen.classList.add("hidden");
        authModal.classList.add("hidden");
    }
}

// 顯示動作選擇選單
function showMenuScreen() {
    currentAppState = STATE_MENU;
    tvWorkoutScreen.classList.add("hidden");
    tvMenuScreen.classList.remove("hidden");
    
    // 旋鈕歸零 (預備)
    knobChannel.style.transform = "rotate(0deg)";
}

// 綁定訓練模式切換按鈕
const btnModeRoutine = document.getElementById("btn-mode-routine");
const btnModeSingle = document.getElementById("btn-mode-single");

if (btnModeRoutine && btnModeSingle) {
    btnModeRoutine.addEventListener("click", () => {
        workoutMode = 'routine';
        btnModeRoutine.classList.add("active");
        btnModeSingle.classList.remove("active");
    });
    
    btnModeSingle.addEventListener("click", () => {
        workoutMode = 'single';
        btnModeSingle.classList.add("active");
        btnModeRoutine.classList.remove("active");
    });
}

// 設定主選單關卡卡片的點擊事件
document.querySelectorAll(".stage-card").forEach(card => {
    card.addEventListener("click", () => {
        if (!isTVOn || currentAppState !== STATE_MENU) return;
        
        const stageIndex = parseInt(card.getAttribute("data-stage"));
        currentStageIndex = stageIndex;
        window.currentStageIndex = stageIndex; // 提供 synth.js 讀取
        
        // 切換至鍛鍊畫面
        currentAppState = STATE_WORKOUT;
        tvMenuScreen.classList.add("hidden");
        tvWorkoutScreen.classList.remove("hidden");

        // 旋轉 Channel 旋鈕作為開關特效
        knobChannel.style.transform = `rotate(${stageIndex * 40}deg)`;

        // 啟動相機、AI 與音樂
        startWorkout();
    });
});

// 點擊返回選單按鈕 (保留相機與模型加載)
btnBackToMenu.addEventListener("click", () => {
    if (currentAppState === STATE_WORKOUT) {
        stopWorkoutAndRelease(false); // 不釋放相機與模型，只重置運動狀態
        showMenuScreen();
    }
});

// 音量旋鈕拖曳控制
let isDraggingVolume = false;
knobVolume.addEventListener("mousedown", (e) => { isDraggingVolume = true; });
document.addEventListener("mouseup", () => { isDraggingVolume = false; });
document.addEventListener("mousemove", (e) => {
    if (isDraggingVolume && isTVOn) {
        const rect = knobVolume.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
        knobVolume.style.transform = `rotate(${angle}deg)`;
        
        let vol = (angle + 180) / 360;
        window.gymSynth.setVolume(vol);
    }
});

// --- 專案動態相機與 AI 資源管理 (核心優化) ---

function startWorkout() {
    // 確保相機與模型已在拉門打開時初始化
    if (!pose) {
        initPoseDetection();
    }
    // 確保鏡頭已啟動
    startWebcam();
    
    // 重設畫布尺寸 (因為先前可能因為隱藏而為0)
    resizeCanvases();

    // 3. 初始化數據與時間
    currentScore = 0;
    currentBeat = 0;
    currentSection = 1;
    currentProgressBeat = 0;
    stageScores = [];
    stageStartTime = Date.now();
    smoothedMatchPct = 0;
    lastUiUpdateTime = 0;

    updateUIForStage();
    const totalBeats = (workoutMode === 'routine') ? 16 : 60;
    workoutBeatProgress.textContent = `BEATS: 0/${totalBeats}`;

    // 4. 啟動音樂伴奏與口令
    window.gymSynth.start();
}

function stopWorkoutAndRelease(fullRelease = false) {
    // 1. 停止音樂播放
    window.gymSynth.stop();

    if (fullRelease) {
        // 2. 停止並關閉鏡頭，釋放影像緩衝區
        stopWebcam();

        // 3. 徹底銷毀 MediaPipe Pose 實例以釋放 WebGL 與 WASM 核心記憶體 (重要！)
        if (pose) {
            console.log("Tearing down MediaPipe Pose Engine to free RAM...");
            try {
                pose.close();
            } catch (e) {
                console.error("Error closing Pose engine:", e);
            }
            pose = null; // 設為 null 供垃圾回收 (Garbage Collection)
        }
    }

    // 4. 重設前端 UI 文字與進度條
    ledMatchPct.textContent = "0%";
    ledMatchPct.className = "led-val";
    ledScore.textContent = "000000";
    matchBar.style.width = "0%";
    poseWarning.classList.add("hidden");
    
    // 清除畫布
    ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
    ctxCoach.clearRect(0, 0, canvasCoach.width, canvasCoach.height);
}

function startWebcam() {
    // 如果相機已經在運行中，直接返回
    if (camera) {
        console.log("Webcam is already running.");
        return;
    }

    // 將鏡頭寬高設定為 320x240 (減半解析度，大幅節省視訊緩衝區 RAM)
    camera = new Camera(videoElement, {
        onFrame: async () => {
            if (isTVOn && currentAppState === STATE_WORKOUT) {
                const now = Date.now();
                // 節流 (Throttle)：限制每 150ms 運算一次 (約 6.6 FPS)
                if (now - lastFrameTime > 150) {
                    lastFrameTime = now;
                    if (pose) {
                        await pose.send({ image: videoElement });
                    }
                }
            }
        },
        width: 320,
        height: 240
    });
    
    camera.start().catch(err => {
        alert("相機開啟失敗，請確認是否已被其他程式佔用或未允許權限！");
        stopWorkoutAndRelease(true);
        if (currentUser) {
            showMenuScreen();
        }
    });
}

function resizeCanvases() {
    const parentW = canvasPlayer.parentElement.clientWidth || 320;
    canvasPlayer.width = parentW;
    canvasPlayer.height = 360;
    
    const coachParentW = canvasCoach.parentElement.clientWidth || 320;
    canvasCoach.width = coachParentW;
    canvasCoach.height = 360;
}

function stopWebcam() {
    if (camera) {
        console.log("Stopping Webcam stream...");
        try {
            camera.stop();
        } catch (e) {
            console.error("Error stopping camera:", e);
        }
        camera = null;
    }
}

// --- 節拍事件同步與自動結束 (onGymBeat) ---
window.currentStageIndex = 0;
window.onGymBeat = function(beatCount, sectionCount) {
    if (!isTVOn || currentAppState !== STATE_WORKOUT) return;
    
    currentBeat = beatCount;
    currentSection = sectionCount;

    const totalBeatsInStage = (workoutMode === 'routine') ? 16 : 60;
    currentProgressBeat = (sectionCount - 1) * 8 + beatCount;
    
    // 更新介面節拍數
    workoutBeatProgress.textContent = `BEATS: ${currentProgressBeat}/${totalBeatsInStage}`;
    ledStage.textContent = `${currentStageIndex}/8`;
    
    // 當前操節完成
    if (currentProgressBeat === totalBeatsInStage) {
        // 1. 計算小節平均分數
        let avgScore = 0;
        if (stageScores.length > 0) {
            avgScore = stageScores.reduce((a, b) => a + b, 0) / stageScores.length;
        }
        avgScore = Math.min(100, Math.round(avgScore));
        
        // 2. 播放換節哨音
        window.gymSynth.playWhistle();

        // 3. 停止音樂，但保留相機與模型運作
        stopWorkoutAndRelease(false);

        // 4. 上傳分節數據到後台資料庫
        uploadStageResult(currentStageIndex, avgScore);

        if (workoutMode === 'routine' && currentStageIndex < 8) {
            // 全套連續做模式：倒數進入下一節
            const countdownOverlay = document.getElementById("countdown-overlay");
            const countdownTitle = document.getElementById("countdown-title");
            const countdownNextLabel = document.getElementById("countdown-next-label");
            const countdownTimer = document.getElementById("countdown-timer");
            
            const nextStageIndex = currentStageIndex + 1;
            countdownTitle.textContent = `【${STAGES[currentStageIndex].name}】完成！`;
            countdownNextLabel.textContent = `下一節：${STAGES[nextStageIndex].name}`;
            countdownTimer.textContent = "3";
            countdownOverlay.classList.remove("hidden");
            
            let count = 3;
            const timerId = setInterval(() => {
                count--;
                countdownTimer.textContent = count;
                
                if (count === 0) {
                    clearInterval(timerId);
                    countdownOverlay.classList.add("hidden");
                    
                    // 自動切換到下一節
                    currentStageIndex = nextStageIndex;
                    window.currentStageIndex = nextStageIndex;
                    
                    // 啟動下一小節
                    startWorkout();
                }
            }, 1000);
        } else {
            // 單節練習模式，或是全套完成
            setTimeout(() => {
                if (workoutMode === 'routine') {
                    alert(`【全套鍛鍊完成！】\n恭喜您完成了所有操節的動作！\n本次全套操練數據已成功記錄，請繼續保持每日做操的良好習慣！`);
                } else {
                    alert(`【鍛鍊完成】\n操節：${STAGES[currentStageIndex].name}\n本次動作平均匹配率：${avgScore}%！\n\n數據已儲存，優化閾值已更新！`);
                }
                showMenuScreen();
            }, 300);
        }
    }
};

function updateUIForStage() {
    const stage = STAGES[currentStageIndex];
    ledStage.textContent = `${currentStageIndex}/8`;
    ledActionName.textContent = stage.name;
    ledCamDir.textContent = stage.camera;
    feedbackText.textContent = stage.desc;
    feedbackSmiley.textContent = "😃";

    // 更新動作指南卡片內容
    const guideTitle = document.getElementById("guide-exercise-title");
    const guideDesc = document.getElementById("guide-exercise-desc");
    const guideCriteria = document.getElementById("guide-exercise-criteria");
    if (guideTitle && guideDesc && guideCriteria) {
        guideTitle.textContent = `${stage.name} 指南 (GUIDE)`;
        guideDesc.textContent = stage.desc;
        if (stage.criteria) {
            guideCriteria.innerHTML = stage.criteria.map(c => `<li>${c}</li>`).join("");
        } else {
            guideCriteria.innerHTML = "";
        }
    }
}

// --- 姿態偵測回調 (繪圖與比對) ---
function onPoseResults(results) {
    if (!isTVOn || currentAppState !== STATE_WORKOUT) return;

    try {
        ctxPlayer.save();
        ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
        
        // 水平翻轉影像以利鏡像操作
        ctxPlayer.translate(canvasPlayer.width, 0);
        ctxPlayer.scale(-1, 1);
        ctxPlayer.drawImage(results.image, 0, 0, canvasPlayer.width, canvasPlayer.height);
        
        if (results.poseLandmarks) {
            ctxPlayer.lineWidth = 4;
            ctxPlayer.strokeStyle = "#39ff14";
            
            // 偵測是否為行動裝置，行動端關閉陰影發光以節省 GPU RAM 與運算
            const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
            if (!isMobile) {
                ctxPlayer.shadowColor = "#39ff14";
                ctxPlayer.shadowBlur = 10;
            } else {
                ctxPlayer.shadowBlur = 0;
            }

            drawSkeleton(ctxPlayer, results.poseLandmarks, canvasPlayer.width, canvasPlayer.height);
            evaluatePose(results.poseLandmarks);
        } else {
            ledMatchPct.textContent = "0%";
            ledMatchPct.className = "led-val text-red";
            matchBar.style.width = "0%";
            feedbackText.textContent = "找不到人影，請退後並確保全身在鏡頭內！";
            feedbackSmiley.textContent = "🤔";
            smoothedMatchPct = 0;
        }
    } catch (error) {
        console.error("Error in onPoseResults callback:", error);
    } finally {
        ctxPlayer.restore();
    }

    // 繪製右側 AI 數位教練
    try {
        drawCoachScreen();
    } catch (error) {
        console.error("Error drawing coach screen:", error);
    }
}

// 繪製骨架的輔助函數
function drawSkeleton(ctx, landmarks, w, h) {
    const connections = [
        [11, 12], [11, 23], [12, 24], [23, 24], 
        [11, 13], [13, 15], [12, 14], [14, 16], 
        [23, 25], [25, 27], [24, 26], [26, 28]  
    ];

    connections.forEach(([p1, p2]) => {
        const pt1 = landmarks[p1];
        const pt2 = landmarks[p2];
        if (pt1 && pt2 && pt1.visibility > 0.5 && pt2.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(pt1.x * w, pt1.y * h);
            ctx.lineTo(pt2.x * w, pt2.y * h);
            ctx.stroke();
        }
    });

    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 0;
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    joints.forEach(j => {
        const pt = landmarks[j];
        if (pt && pt.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

// --- 8式健康操動作判定邏輯 (Heuristic Evaluation) ---
function evaluatePose(landmarks) {
    // 預先檢查所有關鍵人體骨架點是否存在，避免 undefined 屬性存取導致崩潰
    const requiredIndices = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    for (let idx of requiredIndices) {
        if (!landmarks || !landmarks[idx]) {
            ledMatchPct.textContent = "0%";
            ledMatchPct.className = "led-val text-red";
            matchBar.style.width = "0%";
            feedbackText.textContent = "找不到完整人影，請確保全身在鏡頭內！";
            feedbackSmiley.textContent = "🤔";
            smoothedMatchPct = 0;
            return;
        }
    }

    try {
        const stage = STAGES[currentStageIndex];
        
        if (stage.camera === "側面") {
            const ls = landmarks[11];
            const rs = landmarks[12];
            const shoulderGap = Math.abs(ls.x - rs.x);
            if (shoulderGap > 0.15) {
                poseWarning.classList.remove("hidden");
                poseWarning.textContent = "請轉向側身！";
                ledMatchPct.textContent = "0%";
                ledMatchPct.className = "led-val text-red";
                matchBar.style.width = "0%";
                feedbackText.textContent = "此動作需檢測側身骨架，請往左/右轉身 90 度！";
                smoothedMatchPct = 0;
                return;
            } else {
                poseWarning.classList.add("hidden");
            }
        } else {
            poseWarning.classList.add("hidden");
        }

        const lElbowAng = getAngle(landmarks[11], landmarks[13], landmarks[15]);
        const rElbowAng = getAngle(landmarks[12], landmarks[14], landmarks[16]);
        const lKneeAng = getAngle(landmarks[23], landmarks[25], landmarks[27]);
        const rKneeAng = getAngle(landmarks[24], landmarks[26], landmarks[28]);
        
        let matchPct = 0;
        let feedback = "";
        let smiley = "😐";

        const squatTol = configThresholds.squat_tolerance;
        const armTol = configThresholds.arm_tolerance;
        const twistTol = configThresholds.twist_tolerance;

        switch (currentStageIndex) {
        case 0: // 預備動作：兩手插腰
            const lWristHipDist = Math.abs(landmarks[15].y - landmarks[23].y);
            const rWristHipDist = Math.abs(landmarks[16].y - landmarks[24].y);
            if (lWristHipDist < 0.15 && rWristHipDist < 0.15) {
                matchPct = 100;
                feedback = "完美預備！請跟隨音樂節拍...";
                smiley = "😃";
            } else {
                matchPct = 30;
                feedback = "請將雙手手腕插在腰際側邊！";
                smiley = "😐";
            }
            break;

        case 1: // 第一節：下肢運動 (全深蹲)
            const squatAngle = Math.min(lKneeAng, rKneeAng);
            if (squatAngle < 100 + squatTol) {
                matchPct = 100;
                feedback = "非常棒的全深蹲動作！核心收緊。";
                smiley = "😎";
            } else if (squatAngle < 135) {
                matchPct = 60;
                feedback = "蹲得不夠深喔，試著再蹲低一點！";
                smiley = "😐";
            } else {
                matchPct = 10;
                feedback = "請跟著節拍下蹲！背部打直。";
                smiley = "😢";
            }
            break;

        case 2: // 第二節：下肢運動 (半深蹲)
            const halfSquatAngle = Math.min(lKneeAng, rKneeAng);
            if (110 - squatTol <= halfSquatAngle && halfSquatAngle <= 140 + squatTol) {
                matchPct = 100;
                feedback = "標準的半深蹲動作！保持膝蓋穩定。";
                smiley = "😃";
            } else if (halfSquatAngle < 110) {
                matchPct = 40;
                feedback = "蹲得太低了，此小節為半深蹲！";
                smiley = "😐";
            } else {
                matchPct = 15;
                feedback = "請配合拍子微蹲，膝蓋朝前。";
                smiley = "😢";
            }
            break;

        case 3: // 第三節：上肢運動 (向上伸展)
            const lWristSh = landmarks[15].y < landmarks[11].y;
            const rWristSh = landmarks[16].y < landmarks[12].y;
            const armStraight = (lElbowAng > 180 - armTol && rElbowAng > 180 - armTol);
            if (lWristSh && rWristSh && armStraight) {
                matchPct = 100;
                feedback = "雙臂完全伸展！做得很好。";
                smiley = "😎";
            } else if (lWristSh && rWristSh) {
                matchPct = 60;
                feedback = "手高舉了，但請手肘盡量伸直！";
                smiley = "😐";
            } else {
                matchPct = 20;
                feedback = "請雙手高舉過頭！";
                smiley = "😢";
            }
            break;

        case 4: // 第四節：擴胸轉體 (胸腰旋轉)
            const isRightTwist = (currentProgressBeat >= 3 && currentProgressBeat <= 6) || (currentProgressBeat >= 11 && currentProgressBeat <= 14);
            
            if (isRightTwist) {
                const isLeftHandOnRightShoulder = Math.abs(landmarks[15].x - landmarks[12].x) < 0.15;
                const isRightArmOpen = rElbowAng > 140;
                if (isLeftHandOnRightShoulder && isRightArmOpen) {
                    matchPct = 100;
                    feedback = "轉體幅度非常標準！充分伸展胸背。";
                    smiley = "😎";
                } else {
                    matchPct = 40;
                    feedback = "一手搭對肩，另一手水平向後打開！";
                    smiley = "😐";
                }
            } else {
                const isHandsForward = landmarks[15].y < landmarks[11].y + 0.1 && landmarks[16].y < landmarks[12].y + 0.1;
                if (isHandsForward) {
                    matchPct = 100;
                    feedback = "雙手平舉預備... 隨後轉體！";
                    smiley = "😃";
                } else {
                    matchPct = 30;
                    feedback = "雙腳開立與肩同寬，雙手平舉預備。";
                    smiley = "😐";
                }
            }
            break;

        case 5: // 第五節：體側左右彎曲 (體側)
            const shSlope = Math.abs(landmarks[11].y - landmarks[12].y) / Math.abs(landmarks[11].x - landmarks[12].x);
            const targetSlope = Math.tan(15 * Math.PI / 180);
            if (shSlope > targetSlope) {
                matchPct = 100;
                feedback = "側彎角度足夠！感受腰部拉伸。";
                smiley = "😃";
            } else {
                matchPct = 30;
                feedback = "請隨節奏將身體大幅度往左右側彎！";
                smiley = "😐";
            }
            break;

        case 6: // 第六節：前後彎體 (前後彎曲 - 需側身)
            const isBendingForward = (currentProgressBeat >= 2 && currentProgressBeat <= 5) || (currentProgressBeat >= 10 && currentProgressBeat <= 13);
            if (isBendingForward) {
                const handBelowKnee = landmarks[15].y > landmarks[25].y && landmarks[16].y > landmarks[26].y;
                if (handBelowKnee) {
                    matchPct = 100;
                    feedback = "非常棒的前彎！手指盡量觸地。";
                    smiley = "😎";
                } else {
                    matchPct = 50;
                    feedback = "再彎腰向下深探，盡量伸展後腿肌！";
                    smiley = "😐";
                }
            } else {
                const isLeaningBack = landmarks[11].x < landmarks[23].x - 0.05; // 假設面右
                if (isLeaningBack) {
                    matchPct = 100;
                    feedback = "標準後仰！手插腰部。";
                    smiley = "😃";
                } else {
                    matchPct = 40;
                    feedback = "直立回到原位，或手插腰向後微仰！";
                    smiley = "😐";
                }
            }
            break;

        case 7: // 第七節：四肢運動 (協調開合)
            const shoulderW = Math.abs(landmarks[11].x - landmarks[12].x);
            const ankleW = Math.abs(landmarks[27].x - landmarks[28].x);
            const armOpen = landmarks[15].y < landmarks[11].y + 0.1 && landmarks[16].y < landmarks[12].y + 0.1;
            if (ankleW > shoulderW * 1.5 && armOpen) {
                matchPct = 100;
                feedback = "開合跳躍協調完美！";
                smiley = "😎";
            } else {
                matchPct = 45;
                feedback = "踏步開展雙腳，手平平展開！";
                smiley = "😐";
            }
            break;

        case 8: // 第八節：整理運動 (深呼吸緩和)
            const isHandsRaising = (currentProgressBeat % 8) < 4;
            const handsUp = landmarks[15].y < landmarks[11].y;
            const handsDown = landmarks[15].y > landmarks[11].y + 0.2;
            if ((isHandsRaising && handsUp) || (!isHandsRaising && handsDown)) {
                matchPct = 100;
                feedback = "深吸氣... 緩緩吐氣，調整呼吸。";
                smiley = "😃";
            } else {
                matchPct = 50;
                feedback = "跟隨教練動作慢速上下揮臂深呼吸。";
                smiley = "😐";
            }
            break;
    }

    matchPct = Math.round(matchPct);
    stageScores.push(matchPct);

    // 套用指數移動平均 (EMA) 來平滑化數值跳動
    if (stageScores.length === 1) {
        smoothedMatchPct = matchPct;
    } else {
        // 0.25 的權重可以在約 4 幀內平滑過渡，既保留即時性又大幅降低抖動
        smoothedMatchPct = 0.25 * matchPct + 0.75 * smoothedMatchPct;
    }
    const displayScore = Math.round(smoothedMatchPct);

    // 匹配進度條保持即時平滑更新 (維持畫面的流暢反應)
    matchBar.style.width = `${displayScore}%`;

    // 節流：控制評分文字與色彩每 500ms 僅更新一次，徹底解決字體閃爍難以辨識問題
    const now = Date.now();
    if (now - lastUiUpdateTime > 500) {
        lastUiUpdateTime = now;
        ledMatchPct.textContent = `${displayScore}%`;
        
        // 評分數字：紅色代表不及格(<60)，綠色代表及格(>=60)
        if (displayScore < 60) {
            ledMatchPct.className = "led-val text-red";
        } else {
            ledMatchPct.className = "led-val text-green";
        }
    }

    feedbackText.textContent = feedback;
    feedbackSmiley.textContent = smiley;

    if (matchPct > 70) {
        currentScore += Math.round(matchPct / 10);
        ledScore.textContent = String(currentScore).padStart(6, '0');
        
        if (Math.random() < 0.05) {
            window.gymSynth.playScoreSound();
        }
    }
    } catch (error) {
        console.error("Error in evaluatePose:", error);
    }
}

// --- 畫箭頭輔助函式 ---
function drawArrow(ctx, x1, y1, x2, y2, color = "#a82a25", isDashed = true) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    if (isDashed) {
        ctx.setLineDash([4, 4]);
    } else {
        ctx.setLineDash([]);
    }
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// --- 畫曲線箭頭輔助函式 ---
function drawCurvedArrow(ctx, startX, startY, endX, endY, controlX, controlY, color = "#a82a25", isDashed = true) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    if (isDashed) {
        ctx.setLineDash([4, 4]);
    } else {
        ctx.setLineDash([]);
    }
    
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.stroke();
    
    const angle = Math.atan2(endY - controlY, endX - controlX);
    const headLen = 8;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// --- 根據小節繪製引導箭頭 ---
function drawGuideArrows(ctx, stageIndex, beat, section, w, h) {
    const cx = 0.5 * w;
    const cy = 0.45 * h;
    const guideColor = "#a82a25";
    
    switch (stageIndex) {
        case 1: // 全深蹲
        case 2: // 半深蹲
            drawArrow(ctx, cx - 0.12 * w, cy - 0.05 * h, cx - 0.12 * w, cy + 0.15 * h, guideColor, true);
            break;
        case 3: // 上肢伸展
            drawArrow(ctx, cx - 0.15 * w, cy - 0.05 * h, cx - 0.15 * w, cy - 0.3 * h, guideColor, true);
            drawArrow(ctx, cx + 0.15 * w, cy - 0.05 * h, cx + 0.15 * w, cy - 0.3 * h, guideColor, true);
            break;
        case 4: // 擴胸轉體
            const pBeat = ((section - 1) * 8 + beat) % 16 || 16;
            if (pBeat >= 3 && pBeat <= 6) {
                drawCurvedArrow(ctx, cx - 0.12 * w, cy - 0.05 * h, cx + 0.18 * w, cy - 0.05 * h, cx, cy - 0.12 * h, guideColor, true);
            } else if (pBeat >= 11 && pBeat <= 14) {
                drawCurvedArrow(ctx, cx + 0.12 * w, cy - 0.05 * h, cx - 0.18 * w, cy - 0.05 * h, cx, cy - 0.12 * h, guideColor, true);
            } else {
                drawArrow(ctx, cx - 0.05 * w, cy - 0.05 * h, cx - 0.22 * w, cy - 0.05 * h, guideColor, true);
                drawArrow(ctx, cx + 0.05 * w, cy - 0.05 * h, cx + 0.22 * w, cy - 0.05 * h, guideColor, true);
            }
            break;
        case 5: // 體側左右彎曲
            const sinPulse = Math.sin(((section - 1) * 8 + beat) / 16 * Math.PI * 2);
            if (sinPulse > 0) {
                drawCurvedArrow(ctx, cx, cy - 0.32 * h, cx + 0.1 * w, cy - 0.25 * h, cx + 0.08 * w, cy - 0.32 * h, guideColor, true);
            } else {
                drawCurvedArrow(ctx, cx, cy - 0.32 * h, cx - 0.1 * w, cy - 0.25 * h, cx - 0.08 * w, cy - 0.32 * h, guideColor, true);
            }
            break;
        case 6: // 前後彎體
            const isBendingForward = (beat >= 2 && beat <= 5);
            if (isBendingForward) {
                drawCurvedArrow(ctx, cx + 0.08 * w, cy - 0.15 * h, cx + 0.15 * w, cy + 0.15 * h, cx + 0.18 * w, cy, guideColor, true);
            } else {
                drawCurvedArrow(ctx, cx - 0.05 * w, cy - 0.05 * h, cx - 0.12 * w, cy - 0.15 * h, cx - 0.12 * w, cy - 0.08 * h, guideColor, true);
            }
            break;
        case 7: // 四肢運動
            drawArrow(ctx, cx - 0.08 * w, cy - 0.08 * h, cx - 0.22 * w, cy - 0.18 * h, guideColor, true);
            drawArrow(ctx, cx + 0.08 * w, cy - 0.08 * h, cx + 0.22 * w, cy - 0.18 * h, guideColor, true);
            drawArrow(ctx, cx - 0.04 * w, cy + 0.18 * h, cx - 0.12 * w, cy + 0.32 * h, guideColor, true);
            drawArrow(ctx, cx + 0.04 * w, cy + 0.18 * h, cx + 0.12 * w, cy + 0.32 * h, guideColor, true);
            break;
        case 8: // 整理運動
            const isHandsRaising = (beat % 8) < 4;
            if (isHandsRaising) {
                drawArrow(ctx, cx - 0.2 * w, cy + 0.1 * h, cx - 0.2 * w, cy - 0.15 * h, guideColor, true);
                drawArrow(ctx, cx + 0.2 * w, cy + 0.1 * h, cx + 0.2 * w, cy - 0.15 * h, guideColor, true);
            } else {
                drawArrow(ctx, cx - 0.2 * w, cy - 0.15 * h, cx - 0.2 * w, cy + 0.1 * h, guideColor, true);
                drawArrow(ctx, cx + 0.2 * w, cy - 0.15 * h, cx + 0.2 * w, cy + 0.1 * h, guideColor, true);
            }
            break;
    }
}

// --- 繪製 AI 數位教練 (Coach Screen Animation - DEMO 版風格) ---
function drawCoachScreen() {
    ctxCoach.save();
    // 填充復古紙張背景色
    ctxCoach.fillStyle = "#f4edd9";
    ctxCoach.fillRect(0, 0, canvasCoach.width, canvasCoach.height);
    
    // 1. 繪製復古背景網格 (細虛線，深藍色低透明度)
    ctxCoach.strokeStyle = "rgba(25, 56, 92, 0.08)";
    ctxCoach.lineWidth = 1;
    ctxCoach.setLineDash([2, 4]);
    const gridSpacing = 20;
    for (let x = 0; x < canvasCoach.width; x += gridSpacing) {
        ctxCoach.beginPath();
        ctxCoach.moveTo(x, 0);
        ctxCoach.lineTo(x, canvasCoach.height);
        ctxCoach.stroke();
    }
    for (let y = 0; y < canvasCoach.height; y += gridSpacing) {
        ctxCoach.beginPath();
        ctxCoach.moveTo(0, y);
        ctxCoach.lineTo(canvasCoach.width, y);
        ctxCoach.stroke();
    }
    ctxCoach.setLineDash([]); // 恢復實線

    // 2. 依據當前小節與節拍，推算教練的骨架座標
    const coachPose = getCoachKeyframes(currentStageIndex, currentBeat, currentSection);
    
    // 3. 繪製教練 (深藍色墨水骨架)
    ctxCoach.lineWidth = 5;
    ctxCoach.strokeStyle = "#19385c";
    ctxCoach.lineCap = "round";
    ctxCoach.lineJoin = "round";
    ctxCoach.shadowBlur = 0; // 關閉霓虹發光

    const w = canvasCoach.width;
    const h = canvasCoach.height;

    // 計算頸部與頭部座標
    const neckX = (coachPose.shoulderL.x + coachPose.shoulderR.x) / 2;
    const neckY = (coachPose.shoulderL.y + coachPose.shoulderR.y) / 2;
    const headX = neckX;
    const headY = neckY - 0.08;

    // 繪製頭部 (深藍色實心圓)
    ctxCoach.beginPath();
    ctxCoach.arc(headX * w, headY * h, 12, 0, 2 * Math.PI);
    ctxCoach.fillStyle = "#19385c";
    ctxCoach.fill();

    // 繪製頸部到頭的連線
    ctxCoach.beginPath();
    ctxCoach.moveTo(neckX * w, neckY * h);
    ctxCoach.lineTo(headX * w, headY * h);
    ctxCoach.stroke();

    const connections = [
        ['shoulderL', 'shoulderR'], ['shoulderL', 'hipL'], ['shoulderR', 'hipR'], ['hipL', 'hipR'],
        ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
        ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR']
    ];

    connections.forEach(([p1, p2]) => {
        const pt1 = coachPose[p1];
        const pt2 = coachPose[p2];
        if (pt1 && pt2) {
            ctxCoach.beginPath();
            ctxCoach.moveTo(pt1.x * w, pt1.y * h);
            ctxCoach.lineTo(pt2.x * w, pt2.y * h);
            ctxCoach.stroke();
        }
    });

    // 繪製動作引導紅色箭頭
    drawGuideArrows(ctxCoach, currentStageIndex, currentBeat, currentSection, w, h);

    ctxCoach.restore();
}

function getCoachKeyframes(stageIndex, beat, section) {
    const cx = 0.5;
    const cy = 0.45;
    const t = ((section - 1) * 8 + beat) / 16; 

    let pose = {
        shoulderL: { x: cx - 0.08, y: cy - 0.15 },
        shoulderR: { x: cx + 0.08, y: cy - 0.15 },
        hipL: { x: cx - 0.06, y: cy + 0.1 },
        hipR: { x: cx + 0.06, y: cy + 0.1 },
        
        elbowL: { x: cx - 0.12, y: cy - 0.05 },
        wristL: { x: cx - 0.15, y: cy + 0.05 },
        elbowR: { x: cx + 0.12, y: cy - 0.05 },
        wristR: { x: cx + 0.15, y: cy + 0.05 },
        
        kneeL: { x: cx - 0.06, y: cy + 0.25 },
        ankleL: { x: cx - 0.06, y: cy + 0.4 },
        kneeR: { x: cx + 0.06, y: cy + 0.25 },
        ankleR: { x: cx + 0.06, y: cy + 0.4 }
    };

    if (!isTVOn || currentAppState !== STATE_WORKOUT) {
        return pose;
    }

    const sinScale = Math.sin(t * Math.PI * 4);
    const sinPulse = Math.sin(t * Math.PI * 2);

    switch (stageIndex) {
        case 0: // 預備動作
            pose.elbowL = { x: cx - 0.15, y: cy + 0.05 };
            pose.wristL = { x: cx - 0.09, y: cy + 0.1 };
            pose.elbowR = { x: cx + 0.15, y: cy + 0.05 };
            pose.wristR = { x: cx + 0.09, y: cy + 0.1 };
            const readyY = Math.abs(sinScale) * 0.015;
            pose.hipL.y += readyY; pose.hipR.y += readyY;
            pose.kneeL.y += readyY; pose.kneeR.y += readyY;
            break;

        case 1: // 全深蹲
            pose = getSideViewBase(cx, cy);
            const squatDepth = Math.max(0, sinScale) * 0.18;
            pose.hip.y += squatDepth;
            pose.knee.y += squatDepth * 0.5;
            pose.elbow = { x: cx + 0.12, y: cy - 0.15 };
            pose.wrist = { x: cx + 0.22, y: cy - 0.15 };
            break;

        case 2: // 半深蹲
            pose = getSideViewBase(cx, cy);
            const halfDepth = Math.max(0, sinScale) * 0.09;
            pose.hip.y += halfDepth;
            pose.knee.y += halfDepth * 0.5;
            pose.elbow = { x: cx - 0.08, y: cy + 0.05 };
            pose.wrist = { x: cx - 0.02, y: cy + 0.08 };
            break;

        case 3: // 上肢伸展
            pose.elbowL = { x: cx - 0.08, y: cy - 0.25 };
            pose.wristL = { x: cx - 0.08, y: cy - 0.38 };
            pose.elbowR = { x: cx + 0.08, y: cy - 0.25 };
            pose.wristR = { x: cx + 0.08, y: cy - 0.38 };
            const stepY = Math.abs(sinScale) * 0.02;
            pose.hipL.y += stepY; pose.hipR.y += stepY;
            break;

        case 4: // 擴胸轉體
            const pBeat = ((section - 1) * 8 + beat) % 16 || 16;
            if (pBeat >= 3 && pBeat <= 6) {
                pose.shoulderL.x = cx - 0.03;
                pose.shoulderR.x = cx + 0.03;
                pose.elbowL = { x: cx + 0.04, y: cy - 0.12 };
                pose.wristL = { x: cx + 0.05, y: cy - 0.15 };
                pose.elbowR = { x: cx + 0.18, y: cy - 0.15 };
                pose.wristR = { x: cx + 0.28, y: cy - 0.15 };
            } else if (pBeat >= 11 && pBeat <= 14) {
                pose.shoulderL.x = cx - 0.03;
                pose.shoulderR.x = cx + 0.03;
                pose.elbowR = { x: cx - 0.04, y: cy - 0.12 };
                pose.wristR = { x: cx - 0.05, y: cy - 0.15 };
                pose.elbowL = { x: cx - 0.18, y: cy - 0.15 };
                pose.wristL = { x: cx - 0.28, y: cy - 0.15 };
            } else if ((pBeat >= 1 && pBeat <= 2) || (pBeat >= 9 && pBeat <= 10)) {
                pose.elbowL = { x: cx - 0.12, y: cy - 0.15 };
                pose.wristL = { x: cx - 0.22, y: cy - 0.15 };
                pose.elbowR = { x: cx + 0.12, y: cy - 0.15 };
                pose.wristR = { x: cx + 0.22, y: cy - 0.15 };
            }
            break;

        case 5: // 體側左右彎曲
            const bendOffset = sinPulse * 0.06;
            pose.shoulderL.x += bendOffset; pose.shoulderR.x += bendOffset;
            pose.shoulderL.y += bendOffset * 0.5; pose.shoulderR.y -= bendOffset * 0.5;
            pose.elbowL = { x: cx - 0.06 + bendOffset, y: cy - 0.22 };
            pose.wristL = { x: cx - 0.04 + bendOffset, y: cy - 0.35 };
            pose.elbowR = { x: cx + 0.06 + bendOffset, y: cy - 0.22 };
            pose.wristR = { x: cx + 0.04 + bendOffset, y: cy - 0.35 };
            break;

        case 6: // 前後彎體
            pose = getSideViewBase(cx, cy);
            const isForward = (beat >= 2 && beat <= 5);
            if (isForward) {
                pose.shoulder.y += 0.12;
                pose.shoulder.x += 0.08;
                pose.elbow = { x: cx + 0.1, y: cy + 0.15 };
                pose.wrist = { x: cx + 0.12, y: cy + 0.35 };
            } else {
                pose.shoulder.x -= 0.06;
                pose.elbow = { x: cx - 0.08, y: cy + 0.05 };
                pose.wrist = { x: cx - 0.02, y: cy + 0.08 };
            }
            break;

        case 7: // 四肢運動
            const feetWide = 0.07 * (1 + Math.abs(sinScale));
            pose.ankleL.x = cx - feetWide;
            pose.ankleR.x = cx + feetWide;
            pose.kneeL.x = cx - feetWide * 0.8;
            pose.kneeR.x = cx + feetWide * 0.8;
            pose.elbowL = { x: cx - 0.18, y: cy - 0.12 };
            pose.wristL = { x: cx - 0.28, y: cy - 0.12 };
            pose.elbowR = { x: cx + 0.18, y: cy - 0.12 };
            pose.wristR = { x: cx + 0.28, y: cy - 0.12 };
            break;

        case 8: // 整理運動
            const waveY = (sinPulse + 1) * 0.15;
            pose.elbowL = { x: cx - 0.15, y: cy - 0.15 + waveY };
            pose.wristL = { x: cx - 0.26, y: cy - 0.15 + waveY };
            pose.elbowR = { x: cx + 0.15, y: cy - 0.15 + waveY };
            pose.wristR = { x: cx + 0.26, y: cy - 0.15 + waveY };
            break;
    }

    // 若為側身關卡，將無後綴的屬性對照至 L 與 R 後綴，使其正常動畫與繪製
    if (stageIndex === 1 || stageIndex === 2 || stageIndex === 6) {
        pose.shoulderL = pose.shoulder;
        pose.shoulderR = pose.shoulder;
        pose.hipL = pose.hip;
        pose.hipR = pose.hip;
        pose.elbowL = pose.elbow;
        pose.elbowR = pose.elbow;
        pose.wristL = pose.wrist;
        pose.wristR = pose.wrist;
        pose.kneeL = pose.knee;
        pose.kneeR = pose.knee;
        pose.ankleL = pose.ankle;
        pose.ankleR = pose.ankle;
    }

    return pose;
}

function getSideViewBase(cx, cy) {
    return {
        shoulderL: { x: cx, y: cy - 0.15 },
        shoulderR: { x: cx, y: cy - 0.15 },
        shoulder: { x: cx, y: cy - 0.15 },
        
        hipL: { x: cx, y: cy + 0.1 },
        hipR: { x: cx, y: cy + 0.1 },
        hip: { x: cx, y: cy + 0.1 },
        
        elbowL: { x: cx - 0.03, y: cy - 0.05 },
        wristL: { x: cx - 0.05, y: cy + 0.05 },
        elbowR: { x: cx - 0.03, y: cy - 0.05 },
        wristR: { x: cx - 0.05, y: cy + 0.05 },
        elbow: { x: cx - 0.03, y: cy - 0.05 },
        wrist: { x: cx - 0.05, y: cy + 0.05 },
        
        kneeL: { x: cx - 0.02, y: cy + 0.25 },
        ankleL: { x: cx - 0.02, y: cy + 0.4 },
        kneeR: { x: cx - 0.02, y: cy + 0.25 },
        ankleR: { x: cx - 0.02, y: cy + 0.4 },
        knee: { x: cx - 0.02, y: cy + 0.25 },
        ankle: { x: cx - 0.02, y: cy + 0.4 }
    };
}
