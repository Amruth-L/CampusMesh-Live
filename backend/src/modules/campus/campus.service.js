const CAMPUS = {
  id: 'main-campus',
  name: 'CampusMesh Main Campus',
  bounds: { width: 1000, height: 700 },
  buildings: [
    { id: 'entrance', name: 'Main Entrance', type: 'landmark', x: 110, y: 620 },
    { id: 'cafeteria', name: 'Campus Cafeteria', type: 'food', x: 230, y: 190 },
    { id: 'library', name: 'Central Library', type: 'library', x: 720, y: 185 },
    { id: 'a-block', name: 'A-Block', type: 'academic', x: 270, y: 370 },
    { id: 'b-block', name: 'B-Block', type: 'academic', x: 650, y: 360 },
    { id: 'admin', name: 'Admin Block', type: 'admin', x: 210, y: 500 },
    { id: 'parking', name: 'Campus Parking', type: 'parking', x: 480, y: 550 },
    { id: 'hostel', name: 'Boys Hostel', type: 'hostel', x: 830, y: 480 },
    { id: 'xerox', name: 'Campus Xerox Desk', type: 'service', x: 425, y: 285 },
    { id: 'girls-hostel', name: 'Girls Hostel', type: 'hostel', x: 900, y: 620 },
  ],
  edges: [
    ['entrance', 'admin', 170],
    ['admin', 'a-block', 145],
    ['a-block', 'cafeteria', 190],
    ['a-block', 'parking', 280],
    ['parking', 'b-block', 255],
    ['b-block', 'library', 190],
    ['b-block', 'hostel', 225],
    ['hostel', 'girls-hostel', 165],
    ['cafeteria', 'xerox', 215],
    ['xerox', 'b-block', 245],
    ['a-block', 'xerox', 175],
    ['parking', 'hostel', 365],
  ],
};
const node = (id) => CAMPUS.buildings.find((building) => building.id === id);
function shortestPath(startNode, endNode) {
  if (!node(startNode) || !node(endNode)) return null;
  const distances = Object.fromEntries(CAMPUS.buildings.map((item) => [item.id, Infinity]));
  const previous = {};
  const open = new Set(CAMPUS.buildings.map((item) => item.id));
  distances[startNode] = 0;
  while (open.size) {
    let current = null;
    for (const id of open) if (current === null || distances[id] < distances[current]) current = id;
    if (current === endNode || distances[current] === Infinity) break;
    open.delete(current);
    for (const [a, b, meters] of CAMPUS.edges) {
      const neighbor = a === current ? b : b === current ? a : null;
      if (!neighbor || !open.has(neighbor)) continue;
      const candidate = distances[current] + meters;
      if (candidate < distances[neighbor]) {
        distances[neighbor] = candidate;
        previous[neighbor] = current;
      }
    }
  }
  const nodes = [];
  for (let cursor = endNode; cursor; cursor = previous[cursor]) {
    nodes.unshift(cursor);
    if (cursor === startNode) break;
  }
  return nodes[0] === startNode ? { nodes, distanceMeters: distances[endNode] } : null;
}
function routeFor(fromLocation, toLocation) {
  const from = fromLocation?.route_node_id || fromLocation?.building_id || fromLocation;
  const to = toLocation?.route_node_id || toLocation?.building_id || toLocation;
  const route = shortestPath(from, to);
  if (!route) return null;
  const coordinates = route.nodes.map((id) => ({
    nodeId: id,
    x: node(id).x,
    y: node(id).y,
    label: node(id).name,
  }));
  return {
    ...route,
    etaMinutes: Math.max(1, Math.ceil(route.distanceMeters / 78)),
    coordinates,
    segments: coordinates
      .slice(1)
      .map((point, index) => [coordinates[index].x, coordinates[index].y, point.x, point.y]),
    instructions: coordinates.map((point, index) =>
      index === 0
        ? `Start at ${point.label}.`
        : index === coordinates.length - 1
          ? `Arrive at ${point.label}.`
          : `Continue via ${point.label}.`,
    ),
  };
}
function campusPayload() {
  return { ...CAMPUS, paths: CAMPUS.edges.map(([a, b]) => [node(a).x, node(a).y, node(b).x, node(b).y]) };
}
module.exports = { campusPayload, routeFor, shortestPath };
