import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "health_gymnastics.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """初始化資料庫表結構，若不存在則建立，並填入初始閾值資料"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 建立會員表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            age INTEGER NOT NULL,
            height REAL NOT NULL,
            weight REAL NOT NULL,
            gender TEXT NOT NULL
        )
    """)
    
    # 建立運動紀錄表 (支援分節上傳)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS workout_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            movement_index INTEGER NOT NULL,
            movement_name TEXT NOT NULL,
            match_score REAL NOT NULL,
            duration_sec INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    
    # 建立 AI 自適應動作閥值表 (由後端分析器動態更新)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback_thresholds (
            group_key TEXT PRIMARY KEY,
            angle_tolerance_squat REAL NOT NULL,
            angle_tolerance_arm REAL NOT NULL,
            angle_tolerance_twist REAL NOT NULL
        )
    """)
    
    # 寫入預設閾值 (若不存在)
    cursor.execute("SELECT COUNT(*) FROM feedback_thresholds")
    if cursor.fetchone()[0] == 0:
        default_thresholds = [
            ("default", 15.0, 15.0, 15.0),    # 預設：深蹲/半深蹲角度容差、手臂伸直容差、轉體角度容差
            ("age_60+", 25.0, 20.0, 20.0),    # 年長者：放寬判定容差
            ("age_under_18", 12.0, 12.0, 12.0) # 青少年：要求較嚴格
        ]
        cursor.executemany("""
            INSERT INTO feedback_thresholds (group_key, angle_tolerance_squat, angle_tolerance_arm, angle_tolerance_twist)
            VALUES (?, ?, ?, ?)
        """, default_thresholds)
        
    conn.commit()
    conn.close()
    print("Database initialized successfully.")

if __name__ == "__main__":
    init_db()
