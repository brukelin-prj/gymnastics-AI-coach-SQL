from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.responses import FileResponse
from pydantic import BaseModel
import secrets
import database
import analyzer
import os
import uvicorn

# 初始化資料庫
database.init_db()

app = FastAPI(title="第一國民健康操 AI 教練 - 後端 API")

# 開啟 CORS 支援跨裝置存取 (讓手機/平板連網讀取)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic 模型 ---
class RegisterSchema(BaseModel):
    username: str
    password: str
    age: int
    height: float
    weight: float
    gender: str

class LoginSchema(BaseModel):
    username: str
    password: str

class SegmentLogSchema(BaseModel):
    user_id: int
    movement_index: int
    movement_name: str
    match_score: float
    duration_sec: int

# --- API 端點 ---

@app.post("/api/register")
def register(user: RegisterSchema):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO users (username, password, age, height, weight, gender)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user.username, user.password, user.age, user.height, user.weight, user.gender))
        conn.commit()
        user_id = cursor.lastrowid
        return {"status": "success", "message": "註冊成功", "user_id": user_id}
    except database.sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="帳號已被註冊")
    finally:
        conn.close()

@app.post("/api/login")
def login(user: LoginSchema):
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, username, age, height, weight, gender FROM users 
        WHERE username = ? AND password = ?
    """, (user.username, user.password))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            "status": "success",
            "user": {
                "id": row["id"],
                "username": row["username"],
                "age": row["age"],
                "height": row["height"],
                "weight": row["weight"],
                "gender": row["gender"]
            }
        }
    else:
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")

@app.get("/api/thresholds")
def get_thresholds(age: int):
    """根據使用者年齡回傳對應的動態動作判定閾值"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # 決定群組分類
    if age >= 60:
        group_key = "age_60+"
    elif age < 18:
        group_key = "age_under_18"
    else:
        group_key = "default"
        
    cursor.execute("""
        SELECT angle_tolerance_squat, angle_tolerance_arm, angle_tolerance_twist 
        FROM feedback_thresholds WHERE group_key = ?
    """, (group_key,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return {
            "group": group_key,
            "squat_tolerance": row["angle_tolerance_squat"],
            "arm_tolerance": row["angle_tolerance_arm"],
            "twist_tolerance": row["angle_tolerance_twist"]
        }
    else:
        # 安全退路
        return {
            "group": "default",
            "squat_tolerance": 15.0,
            "arm_tolerance": 15.0,
            "twist_tolerance": 15.0
        }

@app.post("/api/upload_segment")
def upload_segment(log: SegmentLogSchema):
    """分節運動數據上傳 API"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO workout_logs (user_id, movement_index, movement_name, match_score, duration_sec)
        VALUES (?, ?, ?, ?, ?)
    """, (log.user_id, log.movement_index, log.movement_name, log.match_score, log.duration_sec))
    conn.commit()
    conn.close()
    
    # 觸發後台自適應分析優化 (異步，此處直接呼叫模擬關閉程式後的處理)
    try:
        analyzer.run_adaptive_analysis()
    except Exception as e:
        print(f"Error during adaptive analysis: {e}")
        
    return {"status": "success", "message": "本小節運動數據已成功記錄，優化閾值已更新"}

@app.get("/api/user_stats")
def get_user_stats(user_id: int):
    """獲取個人歷史統計紀錄"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT movement_index, movement_name, AVG(match_score) as avg_score, MAX(match_score) as max_score, SUM(duration_sec) as total_duration, COUNT(*) as sessions
        FROM workout_logs WHERE user_id = ?
        GROUP BY movement_index, movement_name
    """, (user_id,))
    rows = cursor.fetchall()
    
    # 最近的幾筆分數趨勢
    cursor.execute("""
        SELECT match_score, created_at FROM workout_logs 
        WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    """, (user_id,))
    recent_logs = cursor.fetchall()
    conn.close()
    
    return {
        "summary": [{
            "movement_index": r["movement_index"],
            "movement_name": r["movement_name"],
            "avg_score": r["avg_score"],
            "max_score": r["max_score"],
            "total_duration": r["total_duration"],
            "sessions": r["sessions"]
        } for r in rows],
        "recent": [{"score": r["match_score"], "date": r["created_at"]} for r in recent_logs]
    }

# --- 後台管理 API 與 HTTP Basic 認證 ---
security = HTTPBasic()

def auth_admin(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, "admin")
    correct_password = secrets.compare_digest(credentials.password, "admin888")
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Basic realm=\"Admin Access\""},
        )
    return credentials.username

@app.get("/admin.html")
def get_admin_html(username: str = Depends(auth_admin)):
    """受保護的後台管理 HTML 路由"""
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    return FileResponse(os.path.join(static_dir, "admin.html"))

@app.get("/api/admin/summary")
def get_admin_summary(username: str = Depends(auth_admin)):
    """獲取後台管理總覽統計數據與會員名單"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # 1. 總會員數
    cursor.execute("SELECT COUNT(*) FROM users")
    total_users = cursor.fetchone()[0] or 0
    
    # 2. 總運動小節數與平均得分
    cursor.execute("SELECT COUNT(*), AVG(match_score) FROM workout_logs")
    log_row = cursor.fetchone()
    total_workouts = log_row[0] or 0
    total_reps = total_workouts  # 以完成小節數作為次數
    avg_score = round(log_row[1] or 0, 1)
    
    # 3. 獲取使用者名單及其統計數據
    users_query = """
        SELECT 
            u.id, 
            u.username, 
            u.created_at,
            COUNT(w.id) as total_workouts,
            COALESCE(SUM(w.duration_sec), 0) as total_duration,
            COALESCE(AVG(w.match_score), 0) as avg_score
        FROM users u
        LEFT JOIN workout_logs w ON u.id = w.user_id
        GROUP BY u.id
        ORDER BY u.username ASC
    """
    cursor.execute(users_query)
    rows = cursor.fetchall()
    conn.close()
    
    users = []
    for r in rows:
        users.append({
            "id": r["id"],
            "username": r["username"],
            "created_at": r["created_at"],
            "total_workouts": r["total_workouts"],
            "total_reps": r["total_workouts"],
            "avg_score": round(r["avg_score"], 1),
            "total_duration": r["total_duration"]
        })
        
    return {
        "total_users": total_users,
        "total_workouts": total_workouts,
        "total_reps": total_reps,
        "avg_score": avg_score,
        "users": users
    }

@app.get("/api/workouts")
def get_workouts(user_id: int, username: str = Depends(auth_admin)):
    """獲取特定會員的詳細運動歷史紀錄"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, movement_name as mode, match_score as avg_score, duration_sec, created_at
        FROM workout_logs
        WHERE user_id = ?
        ORDER BY created_at DESC
    """, (user_id,))
    rows = cursor.fetchall()
    conn.close()
    
    logs = []
    for r in rows:
        logs.append({
            "id": r["id"],
            "created_at": r["created_at"],
            "mode": r["mode"],
            "reps": 1,
            "avg_score": round(r["avg_score"], 1)
        })
    return logs

@app.delete("/api/workouts/{log_id}")
def delete_workout(log_id: int, username: str = Depends(auth_admin)):
    """後台管理刪除特定運動紀錄"""
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM workout_logs WHERE id = ?", (log_id,))
    conn.commit()
    changes = cursor.rowcount
    conn.close()
    
    if changes > 0:
        return {"status": "success", "message": "日誌已刪除"}
    else:
        raise HTTPException(status_code=404, detail="找不到該日誌")

# 靜態網頁託管 (若 /static 目錄已建立，則將前端發布在此)
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    # 自動產生 SSL 自簽名憑證
    try:
        import generate_cert
        generate_cert.generate_self_signed_cert()
    except Exception as e:
        print(f"SSL certificate generation skipped/failed: {e}")

    # 檢查憑證是否存在並啟用 HTTPS 啟動 FastAPI
    cert_file = "cert.pem"
    key_file = "key.pem"
    
    if os.path.exists(cert_file) and os.path.exists(key_file):
        print("Starting server over SECURE HTTPS connection...")
        uvicorn.run(
            app, 
            host="0.0.0.0", 
            port=8000,
            ssl_keyfile=key_file,
            ssl_certfile=cert_file
        )
    else:
        print("SSL certificates not found. Starting server over standard HTTP...")
        uvicorn.run(app, host="0.0.0.0", port=8000)

