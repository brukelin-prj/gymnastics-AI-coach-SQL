// --- 8-bit 國民健康操音樂合成器 (Web Audio API) ---

class RetroGymSynth {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;
        this.tempo = 60; // 60 BPM (1拍 = 1.0秒)
        this.volume = 0.5;
        
        // 經典健康操伴奏和弦與旋律音高 (簡譜頻率對照)
        this.frequencies = {
            'C3': 130.81, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00, 'A3': 220.00,
            'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00, 
            'A4': 440.00, 'B4': 493.88, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25
        };

        // 八拍循環旋律音符 (1-8 拍)
        this.melodyNotes = [
            'C4', 'E4', 'G4', 'E4', 'F4', 'A4', 'C5', 'G4', // 第一小節 (1-8拍)
            'A4', 'C5', 'G4', 'E4', 'D4', 'G4', 'C4', 'C4'  // 第二小節 (1-8拍)
        ];

        this.bassNotes = [
            'C3', 'C3', 'C3', 'G3', 'F3', 'F3', 'C3', 'G3',
            'F3', 'C3', 'C3', 'E3', 'G3', 'G3', 'C3', 'C3'
        ];

        // 核心計時變數
        this.schedulerInterval = 25.0; // 毫秒
        this.lookahead = 0.1; // 秒
        this.nextNoteTime = 0.0;
        this.currentNoteIndex = 0; // 當前音符索引 (0-15)
        
        // 運動狀態追蹤 (配合 app.js)
        this.beatCount = 0; // 當前累計拍數 (1-8)
        this.sectionCount = 1; // 當前重複輪數 (1-2)
        this.timerId = null;

        // 口令發聲器 (SpeechSynthesis)
        this.speechSynth = window.speechSynthesis;
        this.voiceEnabled = true;
    }

    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    // 啟動播放
    start() {
        this.init();
        if (this.isPlaying) return;
        
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        this.isPlaying = true;
        this.nextNoteTime = this.ctx.currentTime + 0.1;
        this.currentNoteIndex = 0;
        this.beatCount = 0;
        this.sectionCount = 1;

        // 播放經典哨音 (1拍) 作為起步訊號
        this.playWhistle();
        this.nextNoteTime += 1.0; // 延遲一秒開始

        this.scheduler();
        console.log("Music Synthesizer started at 60 BPM.");
    }

    // 暫停播放
    stop() {
        this.isPlaying = false;
        if (this.timerId) {
            clearTimeout(this.timerId);
        }
        if (this.speechSynth) {
            this.speechSynth.cancel();
        }
    }

    setVolume(val) {
        this.volume = parseFloat(val);
    }

    // --- 音效生成器 (單次發聲) ---

    // 哨音 (開頭或換節時播放)
    playWhistle() {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.4);
        
        gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.45);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
    }

    // 得分音效 (Ding! 霓虹感)
    playScoreSound() {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
        osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, this.ctx.currentTime + 0.16); // G5
        
        gain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.35);
    }

    // --- 音樂排程器 (Scheduler & Audio Loop) ---

    scheduler() {
        if (!this.isPlaying) return;

        while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
            this.scheduleNote(this.currentNoteIndex, this.nextNoteTime);
            this.advanceNote();
        }

        this.timerId = setTimeout(() => this.scheduler(), this.schedulerInterval);
    }

    advanceNote() {
        // 60 BPM 代表每拍 1.0 秒
        const secondsPerBeat = 60.0 / this.tempo; 
        this.nextNoteTime += secondsPerBeat;

        // 音符指針前進
        this.currentNoteIndex = (this.currentNoteIndex + 1) % 16;
    }

    scheduleNote(index, time) {
        // 1. 旋律聲部 (主奏：FC 方波)
        const oscMelody = this.ctx.createOscillator();
        const gainMelody = this.ctx.createGain();
        
        oscMelody.type = 'square'; // 經典 8-bit 方波
        const freqM = this.frequencies[this.melodyNotes[index]];
        oscMelody.frequency.setValueAtTime(freqM, time);
        
        gainMelody.gain.setValueAtTime(this.volume * 0.12, time);
        gainMelody.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
        
        oscMelody.connect(gainMelody);
        gainMelody.connect(this.ctx.destination);
        oscMelody.start(time);
        oscMelody.stop(time + 0.45);

        // 2. 貝斯聲部 (伴奏：三角波)
        const oscBass = this.ctx.createOscillator();
        const gainBass = this.ctx.createGain();
        
        oscBass.type = 'triangle'; // 三角波，聲音溫和扎實
        const freqB = this.frequencies[this.bassNotes[index]];
        oscBass.frequency.setValueAtTime(freqB, time);
        
        gainBass.gain.setValueAtTime(this.volume * 0.22, time);
        gainBass.gain.exponentialRampToValueAtTime(0.01, time + 0.6);
        
        oscBass.connect(gainBass);
        gainBass.connect(this.ctx.destination);
        oscBass.start(time);
        oscBass.stop(time + 0.65);

        // 3. 節奏聲部 (白噪音模擬小鼓 / Hi-Hat)
        this.scheduleNoise(time);

        // 4. 更新前端計數與 Speech 口令發聲 (在音符實際播放時觸發)
        const delay = (time - this.ctx.currentTime) * 1000;
        setTimeout(() => {
            if (this.isPlaying) {
                this.onBeatTrigger();
            }
        }, Math.max(0, delay));
    }

    scheduleNoise(time) {
        // 使用白噪音節奏
        const bufferSize = this.ctx.sampleRate * 0.08; // 80毫秒的噪音
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = buffer;

        // 噪音低通濾波，使其聽起來更像敲擊聲
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(this.volume * 0.08, time);
        gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.07);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        noiseNode.start(time);
    }

    // --- 節拍事件觸發 (更新狀態與發出口令) ---
    onBeatTrigger() {
        this.beatCount = (this.beatCount % 8) + 1;
        
        if (this.beatCount === 1 && this.currentNoteIndex !== 1) {
            // 每 8 拍跳轉一輪
            this.sectionCount = this.sectionCount + 1;
        }

        // 發佈事件供 app.js 監聽，同步教練動畫與比對
        if (window.onGymBeat) {
            window.onGymBeat(this.beatCount, this.sectionCount);
        }

        // 播放語音口令
        this.speakCount();
    }

    // 口令中文發音 (SpeechSynthesis)
    speakCount() {
        if (!this.voiceEnabled || !this.speechSynth) return;

        // 暫停所有之前的語音避免重疊
        this.speechSynth.cancel();

        let phrase = "";
        
        // 預備起口令 (在預備動作的第 1-4 拍播放)
        if (window.currentStageIndex === 0) {
            if (this.sectionCount === 1 && this.beatCount === 1) {
                phrase = "第一國民健康操";
            } else if (this.sectionCount === 1 && this.beatCount === 5) {
                phrase = "兩手插腰";
            } else if (this.sectionCount === 2 && this.beatCount === 1) {
                phrase = "預備";
            } else if (this.sectionCount === 2 && this.beatCount === 5) {
                phrase = "起";
            }
        } else {
            // 其他節次的口令 (例如：一二三四五六七八、二二三四五六七八、三二三四五六七八)
            const sectionNumbers = ["", "一", "二", "三", "四", "五", "六", "七", "八"];
            const numbers = ["一", "二", "三", "四", "五", "六", "七", "八"];
            const currentSecNum = sectionNumbers[this.sectionCount] || "";

            if (this.sectionCount === 1) {
                phrase = numbers[this.beatCount - 1];
            } else {
                if (this.beatCount === 1) {
                    phrase = currentSecNum;
                } else if (this.beatCount === 2) {
                    phrase = "二";
                } else {
                    phrase = numbers[this.beatCount - 1];
                }
            }
        }

        if (phrase) {
            const utterance = new SpeechSynthesisUtterance(phrase);
            utterance.lang = 'zh-TW';
            utterance.rate = 1.2; // 稍微加快講話速度以對齊節拍
            utterance.pitch = 1.0;
            utterance.volume = this.volume * 0.9;
            this.speechSynth.speak(utterance);
        }
    }
}

// 註冊全域物件
window.gymSynth = new RetroGymSynth();
