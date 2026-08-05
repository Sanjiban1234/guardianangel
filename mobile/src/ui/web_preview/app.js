/**
 * Guardian Angel - Web Prototype Interactive Controller
 * Figma File: pkDFVZSUjhwfCPGlJj2iTq
 */

let currentScenario = 'map-normal';
let isSnapshotExpanded = false;

function switchScenario(scenarioKey) {
  currentScenario = scenarioKey;

  // Update button active state
  document.querySelectorAll('.state-btn').forEach(btn => btn.classList.remove('active'));
  if (scenarioKey === 'map-normal') document.getElementById('btnMapNormal').classList.add('active');
  if (scenarioKey === 'breakdown') document.getElementById('btnBreakdown').classList.add('active');
  if (scenarioKey === 'separation-rider') document.getElementById('btnSeparationRider').classList.add('active');
  if (scenarioKey === 'separation-group') document.getElementById('btnSeparationGroup').classList.add('active');
  if (scenarioKey === 'profile') document.getElementById('btnProfile').classList.add('active');
  if (scenarioKey === 'sos') document.getElementById('btnSos').classList.add('active');

  renderActiveScreen();
}

function toggleSnapshot() {
  isSnapshotExpanded = !isSnapshotExpanded;
  renderActiveScreen();
}

function renderActiveScreen() {
  const container = document.getElementById('activeScreenContent');
  if (!container) return;

  if (currentScenario === 'map-normal') {
    container.innerHTML = `
      <div class="header-row">
        <div>
          <span class="eyebrow">GROUP CODE GA-8821</span>
          <h2 class="page-title">Saturday Valley Loop</h2>
        </div>
        <span class="end-link">End ride</span>
      </div>

      <div class="map-canvas">
        <span class="road-label">VALLEY HIGHWAY (N-2)</span>
        <div class="route-line-1"></div>
        <div class="route-line-2"></div>
        <div class="marker you">YOU</div>
        <div class="marker m">M</div>
        <div class="marker j">J</div>
      </div>

      <div class="roster-card">
        <span class="roster-title">Ride Group Members (4 Riders)</span>
        <div class="roster-item">
          <div class="dot green"></div>
          <div class="roster-col">
            <div class="roster-name">Alex Vance (You)</div>
            <div class="roster-vehicle">Bajaj Pulsar 150 · BA 2 PA 1234</div>
          </div>
        </div>
        <div class="roster-item">
          <div class="dot green"></div>
          <div class="roster-col">
            <div class="roster-name">Jordan Lee</div>
            <div class="roster-vehicle">KTM Duke 390 · BA 1 PA 9901</div>
          </div>
        </div>
        <div class="roster-item">
          <div class="dot green"></div>
          <div class="roster-col">
            <div class="roster-name">Maya Lin</div>
            <div class="roster-vehicle">Yamaha MT-07 · BA 4 PA 4410</div>
          </div>
        </div>
        <div class="roster-item">
          <div class="dot gray"></div>
          <div class="roster-col">
            <div class="roster-name">Sam Miller</div>
            <div class="roster-vehicle">Royal Enfield Interceptor 650 (Cached)</div>
          </div>
        </div>
      </div>

      <button class="action-btn" style="background:#2B2008; border:1px solid #F59E0B; color:#F59E0B;" onclick="switchScenario('breakdown')">
        ⚠️ Report Breakdown (Press & Hold)
      </button>
    `;
  }

  else if (currentScenario === 'breakdown') {
    container.innerHTML = `
      <div class="header-row">
        <div>
          <span class="eyebrow">GROUP CODE GA-8821</span>
          <h2 class="page-title">Saturday Valley Loop</h2>
        </div>
        <span class="end-link">End ride</span>
      </div>

      <!-- BREAKDOWN ALERT BANNER (#F59E0B) -->
      <div class="breakdown-banner">
        <div class="breakdown-header">
          <div>
            <span class="badge-warning">⚠️ VEHICLE BREAKDOWN</span>
            <div class="breakdown-title">Jordan Lee's KTM Duke 390</div>
          </div>
          <button class="resolve-btn" onclick="switchScenario('map-normal')">Clear / Rejoined</button>
        </div>
        <div class="breakdown-reason-text">REASON: 🛞 Flat Tire</div>
        <div class="breakdown-meta">Plate: BA 1 PA 9901 · Color: Obsidian Black</div>
        <div class="breakdown-note">"Rear tire punctured on gravel segment near KM 18."</div>

        <!-- PRIVACY-GATED MEDICAL SNAPSHOT -->
        <div class="medical-snapshot-box">
          <div class="snapshot-toggle" onclick="toggleSnapshot()">
            <span class="snapshot-toggle-text">🩸 Emergency Medical ID Snapshot ${isSnapshotExpanded ? '▲ Hide' : '▼ View'}</span>
            <span style="font-size:9px; color:#A3B8A8;">Gated Payload</span>
          </div>
          ${isSnapshotExpanded ? `
            <div class="snapshot-body">
              <div><strong>Blood Group:</strong> O+</div>
              <div><strong>Allergies:</strong> Penicillin</div>
              <div><strong>Emergency Contact:</strong> Sarah Vance +1-555-0199</div>
              <div><strong>Notes:</strong> Wears prescription glasses under visor.</div>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="map-canvas">
        <span class="road-label">VALLEY HIGHWAY (N-2)</span>
        <div class="route-line-1"></div>
        <div class="route-line-2"></div>
        <div class="marker you">YOU</div>
        <div class="breakdown-pin">⚠️ REPAIR</div>
      </div>

      <div class="roster-card">
        <span class="roster-title">Group Roster</span>
        <div class="roster-item">
          <div class="dot amber"></div>
          <div class="roster-col">
            <div class="roster-name">Jordan Lee</div>
            <div class="roster-vehicle">KTM Duke 390 (BREAKDOWN REPORTED)</div>
          </div>
        </div>
      </div>
    `;
  }

  else if (currentScenario === 'separation-rider') {
    container.innerHTML = `
      <div class="header-row">
        <div>
          <span class="eyebrow">GROUP CODE GA-8821</span>
          <h2 class="page-title">Saturday Valley Loop</h2>
        </div>
        <span class="end-link">End ride</span>
      </div>

      <!-- SEPARATION BANNER (RIDER VIEW) -->
      <div class="separation-banner">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="badge-warning">📍 GROUP SEPARATION (>500m)</span>
          <span style="font-size:10px; color:#A3B8A8;">Auto-clears on reunite</span>
        </div>
        <div style="font-size:14px; font-weight:800; margin-top:2px;">You are lagging behind the main group.</div>
        <div class="speedGuidancePill speed-guidance-pill">
          ⚡ SUGGESTED TARGET SPEED: 45–55 km/h (Capped Catch-up)
        </div>
        <div class="midpoint-text">📍 Meeting Area: Approximate straight-line midpoint ahead (KM 14.2)</div>
      </div>

      <div class="map-canvas">
        <span class="road-label">VALLEY HIGHWAY (N-2)</span>
        <div class="route-line-1"></div>
        <div class="route-line-2"></div>
        <div class="marker you">YOU</div>
        <div class="midpoint-marker">
          <div class="midpoint-circle"></div>
          <div class="midpoint-label">APPROXIMATE MEETING AREA</div>
        </div>
      </div>
    `;
  }

  else if (currentScenario === 'separation-group') {
    container.innerHTML = `
      <div class="header-row">
        <div>
          <span class="eyebrow">GROUP CODE GA-8821</span>
          <h2 class="page-title">Saturday Valley Loop</h2>
        </div>
        <span class="end-link">End ride</span>
      </div>

      <!-- SEPARATION BANNER (GROUP VIEW) -->
      <div class="separation-banner">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="badge-warning">📍 GROUP SEPARATION (>500m)</span>
          <span style="font-size:10px; color:#A3B8A8;">Auto-clears on reunite</span>
        </div>
        <div style="font-size:14px; font-weight:800; margin-top:2px;">Rider Jordan Lee separated from group.</div>
        <div class="speed-guidance-pill group-slow">
          🐢 SUGGESTED TARGET SPEED: 30–40 km/h (Capped Slow Down)
        </div>
        <div class="midpoint-text">📍 Meeting Area: Approximate straight-line midpoint ahead (KM 14.2)</div>
      </div>

      <div class="map-canvas">
        <span class="road-label">VALLEY HIGHWAY (N-2)</span>
        <div class="route-line-1"></div>
        <div class="route-line-2"></div>
        <div class="marker you">YOU</div>
        <div class="midpoint-marker">
          <div class="midpoint-circle"></div>
          <div class="midpoint-label">APPROXIMATE MEETING AREA</div>
        </div>
      </div>
    `;
  }

  else if (currentScenario === 'profile') {
    container.innerHTML = `
      <div>
        <span class="eyebrow">RIDER PROFILE & SETTINGS</span>
        <h2 class="page-title">Vehicle & Medical ID</h2>
      </div>

      <div class="profile-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:14px; font-weight:800;">🏍️ Vehicle Details</span>
          <span style="font-size:9px; color:#A3B8A8;">AMBIENT / VISIBLE TO GROUP</span>
        </div>
        
        <div class="field-group">
          <label class="field-label">VEHICLE MAKE & MODEL</label>
          <input type="text" class="input-field" value="Bajaj Pulsar 150">
        </div>
        <div class="field-group">
          <label class="field-label">LICENSE PLATE NUMBER</label>
          <input type="text" class="input-field" value="BA 2 PA 1234">
        </div>
        <div class="field-group">
          <label class="field-label">VEHICLE COLOR</label>
          <input type="text" class="input-field" value="Matte Black">
        </div>
      </div>

      <div class="profile-card medical">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:14px; font-weight:800;">🩸 Rider Medical ID</span>
          <span style="font-size:9px; color:#F59E0B; background:#382606; padding:2px 6px; border-radius:4px;">GATED — SOS & BREAKDOWN ONLY</span>
        </div>

        <div class="field-group">
          <label class="field-label">BLOOD GROUP</label>
          <div class="picker-row">
            <span class="chip active">O+</span>
            <span class="chip">O-</span>
            <span class="chip">A+</span>
            <span class="chip">B+</span>
            <span class="chip">AB+</span>
          </div>
        </div>

        <div class="field-group">
          <label class="field-label">ALLERGIES (OPTIONAL)</label>
          <input type="text" class="input-field" value="Penicillin">
        </div>

        <div class="field-group">
          <label class="field-label">EMERGENCY CONTACT</label>
          <input type="text" class="input-field" value="Sarah Vance (Sister) +1-555-0199">
        </div>
      </div>

      <button class="action-btn" onclick="switchScenario('map-normal')">Save Rider Profile & Settings</button>
    `;
  }

  else if (currentScenario === 'sos') {
    container.innerHTML = `
      <div class="sos-page">
        <div class="sos-badge">!</div>
        <span class="eyebrow">SOS SENT</span>
        <h2 class="page-title">Help is being notified.</h2>
        <p style="font-size:13px; color:#A3B8A8;">Your ride group and listed guardians received your last known location.</p>

        <div class="sos-medical-box">
          <div style="display:flex; justify-content:space-between;">
            <strong style="color:#FCA5A5;">🩸 Attached Medical ID Snapshot</strong>
            <span style="font-size:9px; background:#4D1B1E; padding:2px 6px; border-radius:4px; color:#FCA5A5;">Gated Payload</span>
          </div>
          <div><strong>Blood Group:</strong> O+</div>
          <div><strong>Allergies:</strong> Penicillin</div>
          <div><strong>Emergency Contact:</strong> Sarah Vance +1-555-0199</div>
          <div><strong>Vehicle:</strong> Bajaj Pulsar 150 (BA 2 PA 1234)</div>
        </div>

        <button class="action-btn" style="width:100%;" onclick="switchScenario('map-normal')">Return to Live Map</button>
      </div>
    `;
  }
}

function toggleHandoffModal() {
  const modal = document.getElementById('handoffModal');
  if (modal) modal.classList.toggle('hidden');
}

// Initial render
document.addEventListener('DOMContentLoaded', () => {
  renderActiveScreen();
});
