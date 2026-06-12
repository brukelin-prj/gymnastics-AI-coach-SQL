import database

def run_adaptive_analysis():
    """
    分析所有使用者的運動紀錄，根據不同人口特徵群組的平均表現，
    自動更新並調整 AI 判定的動作角度容許度 (feedback_thresholds)
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()
    
    # 讀取當前的群組與閾值
    cursor.execute("SELECT group_key, angle_tolerance_squat, angle_tolerance_arm, angle_tolerance_twist FROM feedback_thresholds")
    groups = {row["group_key"]: {
        "squat": row["angle_tolerance_squat"],
        "arm": row["angle_tolerance_arm"],
        "twist": row["angle_tolerance_twist"]
    } for row in cursor.fetchall()}
    
    # 依群組統計平均分數 (分段統計)
    # 我們將使用者分為：年長組(60歲以上)、青少年組(18歲以下)、一般組
    queries = {
        "age_60+": "SELECT AVG(match_score), COUNT(*) FROM workout_logs wl JOIN users u ON wl.user_id = u.id WHERE u.age >= 60",
        "age_under_18": "SELECT AVG(match_score), COUNT(*) FROM workout_logs wl JOIN users u ON wl.user_id = u.id WHERE u.age < 18",
        "default": "SELECT AVG(match_score), COUNT(*) FROM workout_logs wl JOIN users u ON wl.user_id = u.id WHERE u.age >= 18 AND u.age < 60"
    }
    
    updated = False
    for group_key, query in queries.items():
        if group_key not in groups:
            continue
            
        cursor.execute(query)
        row = cursor.fetchone()
        avg_score = row[0]
        count = row[1]
        
        # 僅當該群組有足夠的運動資料 (例如大於 5 筆) 時才進行優化分析
        if count >= 5 and avg_score is not None:
            current = groups[group_key]
            new_squat = current["squat"]
            new_arm = current["arm"]
            new_twist = current["twist"]
            
            # 自適應調整法則：
            # 1. 若平均匹配分數低於 75 分，代表判定可能過嚴，應適度調寬容差以鼓勵使用者 (+1.5度)
            if avg_score < 75.0:
                new_squat = min(30.0, current["squat"] + 1.5)
                new_arm = min(25.0, current["arm"] + 1.5)
                new_twist = min(25.0, current["twist"] + 1.5)
                updated = True
            # 2. 若平均匹配分數高於 90 分，代表難度過低，可微幅縮緊容差 (-0.5度)
            elif avg_score > 90.0:
                new_squat = max(10.0, current["squat"] - 0.5)
                new_arm = max(10.0, current["arm"] - 0.5)
                new_twist = max(10.0, current["twist"] - 0.5)
                updated = True
                
            if updated:
                cursor.execute("""
                    UPDATE feedback_thresholds 
                    SET angle_tolerance_squat = ?, angle_tolerance_arm = ?, angle_tolerance_twist = ?
                    WHERE group_key = ?
                """, (new_squat, new_arm, new_twist, group_key))
                print(f"Updated group '{group_key}' thresholds due to avg score {avg_score:.1f}% -> Squat: {new_squat} deg, Arm: {new_arm} deg, Twist: {new_twist} deg")
                
    if updated:
        conn.commit()
    else:
        print("Aggregate analysis completed. No threshold adjustment required.")
        
    conn.close()

if __name__ == "__main__":
    run_adaptive_analysis()
