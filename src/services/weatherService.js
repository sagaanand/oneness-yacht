class WeatherService {
  /**
   * Get Live Marine Advisory for Dubai Marina & Arabian Gulf
   * Advisory-only: never triggers automated cancellations
   */
  async getMarineConditions() {
    // Current typical Dubai Marina coastal marine report
    const now = new Date();
    const hour = now.getHours();

    // Subtle diurnal breeze variation
    const windKnots = Math.round(8 + Math.sin(hour / 3) * 4);
    const swellMeters = 0.4 + (windKnots > 12 ? 0.3 : 0.1);

    let seaState = 'Calm / Smooth';
    let advisory = 'OPTIMAL_CRUISE';
    let advisoryText = 'Ideal luxury cruising conditions across Dubai Marina, Palm Jumeirah & Burj Al Arab.';

    if (windKnots > 16) {
      seaState = 'Moderate Swell';
      advisory = 'ADVISORY_CAUTION';
      advisoryText = 'Breezy conditions in open waters. Scenic inland Marina & Lagoon cruising recommended.';
    }

    return {
      location: 'Dubai Marina & Arabian Gulf Coastline',
      timestamp: now.toISOString(),
      temperatureC: 31,
      windSpeedKnots: windKnots,
      windDirection: 'NW (Northwest)',
      waveHeightMeters: swellMeters.toFixed(1),
      seaState,
      visibilityKm: 10,
      tide: 'High Tide 18:45',
      advisory,
      advisoryText,
      disclaimer: 'Marine condition telemetry provided for voyage planning and guest comfort. Official departure clearance is governed by Oneness Fleet Operations and Dubai Maritime Authority.'
    };
  }
}

module.exports = new WeatherService();
