export function normalizeCampusLocations(payload) {
  const locations = Array.isArray(payload) ? payload : payload?.locations;
  return Array.isArray(locations) ? locations : [];
}

export function campusLocationLabel(location) {
  if (!location) return "Campus location";

  const parts = [
    location.building_name || location.name || location.building,
    location.floor_name || location.floor,
    location.room_name || location.room,
  ].filter(Boolean);

  return parts.join(" · ") || location.label || location.id || "Campus location";
}
