import { motion } from "motion/react";
const colors = {
  academic: "#c6e5ff",
  library: "#afe0d0",
  hostel: "#f7d6a8",
  food: "#ffd6ac",
  service: "#dccef8",
  parking: "#d8dde5",
  admin: "#f8c5c9",
  landmark: "#bee8b0",
};
export default function CampusRouteMap({
  campus,
  route,
  position,
  pickup,
  destination,
}) {
  if (!campus)
    return (
      <div className="aspect-[16/10] animate-pulse rounded-3xl bg-ink/5" />
    );
  const points =
    route?.coordinates?.map((point) => `${point.x},${point.y}`).join(" ") || "";
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-ink/10 bg-[#edf4e8]">
      <svg
        viewBox={`0 0 ${campus.bounds.width} ${campus.bounds.height}`}
        className="aspect-[16/10] w-full"
      >
        <defs>
          <pattern
            id="grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 30 0 L 0 0 0 30"
              fill="none"
              stroke="#173125"
              strokeOpacity=".04"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        {campus.paths.map((path, index) => (
          <line
            key={index}
            x1={path[0]}
            y1={path[1]}
            x2={path[2]}
            y2={path[3]}
            stroke="#fff"
            strokeWidth="30"
            strokeLinecap="round"
          />
        ))}
        {campus.buildings.map((building) => (
          <g key={building.id}>
            <rect
              x={building.x - 62}
              y={building.y - 34}
              width="124"
              height="68"
              rx="14"
              fill={colors[building.type] || "#dbe7d7"}
              stroke="#173125"
              strokeOpacity=".18"
            />
            <text
              x={building.x}
              y={building.y + 5}
              textAnchor="middle"
              fontSize="13"
              fontWeight="800"
              fill="#173125"
            >
              {building.name}
            </text>
          </g>
        ))}
        {points && (
          <>
            <polyline
              points={points}
              fill="none"
              stroke="#fff"
              strokeWidth="15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <motion.polyline
              points={points}
              fill="none"
              stroke="#2868e8"
              strokeWidth="8"
              strokeDasharray="14 12"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1 }}
            />
          </>
        )}
        {pickup && (
          <circle
            cx={pickup.x}
            cy={pickup.y}
            r="13"
            fill="#20a85b"
            stroke="#fff"
            strokeWidth="6"
          />
        )}
        {destination && (
          <circle
            cx={destination.x}
            cy={destination.y}
            r="13"
            fill="#e54755"
            stroke="#fff"
            strokeWidth="6"
          />
        )}
        {position && (
          <motion.circle
            animate={{ cx: Number(position.x), cy: Number(position.y) }}
            r="14"
            fill="#2868e8"
            stroke="#fff"
            strokeWidth="6"
          />
        )}
      </svg>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-xl bg-white/90 px-3 py-2 text-[10px] font-bold shadow backdrop-blur">
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-blue-600" />
          Courier
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-green-600" />
          Pickup
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-red-500" />
          Drop-off
        </span>
      </div>
    </div>
  );
}
