/**
 * Guardian Angel - Core Screen #6: Post-Ride Summary Preview Controller
 */

// Data State Definitions
const MOCK_DATA = {
  full: {
    roomCode: 'GA-8821',
    membersCount: 4,
    distanceKm: '48.2',
    actualTime: '1h 12m',
    benchmarkTime: '1h 04m',
    paceText: '+8 mins vs standard group pace (45 km/h avg). Accounts for group regrouping stops along route.',
    maxSpeed: '84 km/h',
    speedSpikeCount: 1,
    hasLowData: false,
    hadEmergency: false,
    weather: {
      temp: '24.5°C',
      cond: 'Clear Sky',
      sub: 'Wind 14 km/h • Precip 0%'
    },
    speedPoints: [
      { km: 0, speed: 0 },
      { km: 4.2, speed: 38 },
      { km: 9.8, speed: 52 },
      { km: 15.1, speed: 48 },
      { km: 21.0, speed: 64 },
      { km: 28.4, speed: 59 },
      { km: 34.2, speed: 84, isSpike: true },
      { km: 39.0, speed: 45 },
      { km: 44.5, speed: 32 },
      { km: 48.2, speed: 0 }
    ]
  },

  low: {
    roomCode: 'GA-3304',
    membersCount: 3,
    distanceKm: '350',
    distanceUnit: 'm',
    actualTime: '5m',
    benchmarkTime: 'Unavailable',
    paceText: 'Short ride distance — pace comparison requires at least 1.0 km recorded data.',
    maxSpeed: '18 km/h',
    speedSpikeCount: 0,
    hasLowData: true,
    lowDataReason: 'Ride distance was under 500 meters. Speed profiles require a minimum route distance to generate meaningful telemetry graphs.',
    hadEmergency: false,
    weather: null,
    speedPoints: [
      { km: 0, speed: 0 },
      { km: 0.35, speed: 18 }
    ]
  },

  emergency: {
    roomCode: 'GA-9912',
    membersCount: 5,
    distanceKm: '32.4',
    actualTime: '58m',
    benchmarkTime: '43m',
    paceText: '+15 mins vs standard group pace due to emergency SOS roadside check.',
    maxSpeed: '76 km/h',
    speedSpikeCount: 0,
    hasLowData: false,
    hadEmergency: true,
    weather: {
      temp: '22.0°C',
      cond: 'Overcast',
      sub: 'Wind 18 km/h • Precip 20%'
    },
    speedPoints: [
      { km: 0, speed: 0 },
      { km: 5.0, speed: 42 },
      { km: 11.2, speed: 58 },
      { km: 18.4, speed: 0 }, // Emergency halt point
      { km: 24.1, speed: 62 },
      { km: 32.4, speed: 0 }
    ]
  }
};

let currentStateKey = 'full';

function switchState(stateKey) {
  currentStateKey = stateKey;
  
  // Update state button styles
  document.querySelectorAll('.state-btn').forEach(btn => btn.classList.remove('active'));
  if (stateKey === 'full') document.getElementById('btnStateFull').classList.add('active');
  if (stateKey === 'low') document.getElementById('btnStateLow').classList.add('active');
  if (stateKey === 'emergency') document.getElementById('btnStateEmergency').classList.add('active');

  const data = MOCK_DATA[stateKey];

  // Hero Card updates
  document.getElementById('roomCodeText').innerText = `ROOM #${data.roomCode}`;
  document.getElementById('heroSubtitleText').innerText = `Group Ride with ${data.membersCount} Riders • Telemetry Recorded`;

  // Emergency banner
  const emergencyBanner = document.getElementById('emergencyBanner');
  if (data.hadEmergency) {
    emergencyBanner.classList.remove('hidden');
  } else {
    emergencyBanner.classList.add('hidden');
  }

  // Distance Metric
  if (stateKey === 'low') {
    document.getElementById('distanceValue').innerText = '350';
    document.getElementById('distanceUnit').innerText = 'm';
  } else {
    document.getElementById('distanceValue').innerText = data.distanceKm;
    document.getElementById('distanceUnit').innerText = 'km';
  }

  // Time Comparison
  document.getElementById('actualTimeValue').innerText = data.actualTime;
  document.getElementById('benchmarkTimeValue').innerText = data.benchmarkTime;
  document.getElementById('paceExplanationText').innerText = data.paceText;

  // Speed Profile vs Low Data
  const chartContainer = document.getElementById('chartContainer');
  const lowDataBanner = document.getElementById('lowDataBanner');
  const speedPeakBadge = document.getElementById('speedPeakBadge');

  if (data.hasLowData) {
    chartContainer.classList.add('hidden');
    lowDataBanner.classList.remove('hidden');
    speedPeakBadge.classList.add('hidden');
    document.getElementById('lowDataText').innerText = data.lowDataReason;
  } else {
    chartContainer.classList.remove('hidden');
    lowDataBanner.classList.add('hidden');
    speedPeakBadge.classList.remove('hidden');
    document.getElementById('speedPeakText').innerText = `Max: ${data.maxSpeed}`;
    renderSvgChart(data.speedPoints);
  }

  // Weather Section
  const weatherContent = document.getElementById('weatherContent');
  const weatherEmpty = document.getElementById('weatherEmpty');

  if (data.weather) {
    weatherContent.classList.remove('hidden');
    weatherEmpty.classList.add('hidden');
    document.getElementById('weatherTemp').innerText = data.weather.temp;
    document.getElementById('weatherCond').innerText = data.weather.cond;
    document.getElementById('weatherDetails').innerText = data.weather.sub;
  } else {
    weatherContent.classList.add('hidden');
    weatherEmpty.classList.remove('hidden');
  }
}

function renderSvgChart(points) {
  if (!points || points.length === 0) return;

  const width = 340;
  const height = 110;
  const maxSpeed = Math.max(...points.map(p => p.speed), 80);
  const maxKm = points[points.length - 1].km || 1;

  // Compute SVG coordinates
  const coords = points.map(pt => {
    const x = (pt.km / maxKm) * width;
    const y = height - (pt.speed / maxSpeed) * (height - 20) - 10;
    return { x, y, pt };
  });

  // Build SVG path string
  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    pathD += ` L ${coords[i].x} ${coords[i].y}`;
  }

  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

  document.getElementById('speedLinePath').setAttribute('d', pathD);
  document.getElementById('speedAreaPath').setAttribute('d', areaD);

  // Render SVG nodes
  const nodesGroup = document.getElementById('svgNodesGroup');
  nodesGroup.innerHTML = '';

  coords.forEach((coord, idx) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', coord.x);
    circle.setAttribute('cy', coord.y);
    circle.setAttribute('r', coord.pt.isSpike ? '5.5' : '4');
    circle.setAttribute('fill', coord.pt.isSpike ? '#F59E0B' : '#2F80ED');
    circle.setAttribute('stroke', '#0B130E');
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('class', 'chart-node');

    circle.onclick = () => selectWaypoint(coord.pt);
    nodesGroup.appendChild(circle);
  });

  // Distance axis
  const axisContainer = document.getElementById('distanceAxis');
  axisContainer.innerHTML = '';
  const stepCount = 5;
  for (let i = 0; i <= stepCount; i++) {
    const kmVal = ((maxKm / stepCount) * i).toFixed(1);
    const labelSpan = document.createElement('span');
    labelSpan.innerText = `${kmVal}k`;
    axisContainer.appendChild(labelSpan);
  }

  // Select default highlighted point (e.g. spike point or peak point)
  const spikePoint = points.find(p => p.isSpike) || points[Math.floor(points.length / 2)];
  selectWaypoint(spikePoint);
}

function selectWaypoint(pt) {
  const kmEl = document.getElementById('tooltipKm');
  const tagEl = document.getElementById('tooltipTag');
  const speedEl = document.getElementById('tooltipSpeed');

  kmEl.innerText = `Waypoint at ${pt.km} km`;
  speedEl.innerText = `${pt.speed} km/h`;

  if (pt.isSpike) {
    tagEl.innerText = 'Speed Spike Flagged';
    tagEl.className = 'tooltip-tag warning';
  } else {
    tagEl.innerText = 'Cruising Telemetry';
    tagEl.className = 'tooltip-tag';
  }
}

function toggleHandoffModal() {
  const modal = document.getElementById('handoffModal');
  modal.classList.toggle('hidden');
}

// Initial setup on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  switchState('full');
});
