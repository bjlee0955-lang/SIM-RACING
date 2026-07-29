// 오리지널 GT3급 차량 3종
// 실제 브랜드/차량과 무관한 창작 스펙. 성능 값은 게임플레이 밸런스 기준(임의 단위).
export const CARS = [
  {
    id: 'falcon',
    name: 'Falcon GT3',
    color: 0xff5a2e,
    desc: '가볍고 민첩한 올라운더',
    maxSpeed: 285,        // km/h
    accel: 1.0,           // 가속 계수
    brake: 1.05,          // 제동 계수
    corner: 1.08,         // 코너링 계수 (그립)
    baseWeight: 1245,     // kg (연료 제외)
    weightPenalty: 1.0,   // 무게 영향 민감도
  },
  {
    id: 'wolf',
    name: 'Wolf R EVO',
    color: 0x2ee6a6,
    desc: '밸런스형 표준 차량',
    maxSpeed: 295,
    accel: 0.95,
    brake: 1.0,
    corner: 1.0,
    baseWeight: 1300,
    weightPenalty: 1.05,
  },
  {
    id: 'viper',
    name: 'Viper LMS',
    color: 0xffd23f,
    desc: '고속 특화, 무겁고 둔중함',
    maxSpeed: 310,
    accel: 0.85,
    brake: 0.9,
    corner: 0.88,
    baseWeight: 1380,
    weightPenalty: 1.15,
  },
];

export const TIRES = [
  { id: 'soft', name: 'Soft', grip: 1.12, wearRate: 1.5 },
  { id: 'medium', name: 'Medium', grip: 1.0, wearRate: 1.0 },
  { id: 'hard', name: 'Hard', grip: 0.90, wearRate: 0.65 },
];

export const FUEL_OPTIONS = [30, 50, 70]; // liters
