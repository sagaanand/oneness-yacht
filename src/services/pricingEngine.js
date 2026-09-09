const db = require('../db/connection');

class PricingEngine {
  /**
   * Calculate authoritative charter pricing breakdown
   * @param {Object} params
   * @param {Object} params.yacht
   * @param {Date} params.startTime
   * @param {Date} params.endTime
   * @param {number} params.durationHours
   * @param {number} params.guestCount
   * @param {Array<string>} [params.selectedAddonCodes] - Array of add-on codes
   * @returns {Promise<Object>} itemized breakdown and grand total
   */
  async calculatePrice({ yacht, startTime, endTime, durationHours, guestCount, selectedAddonCodes = [] }) {
    // 1. Fetch active pricing rules
    const rulesRes = await db.query('SELECT * FROM pricing_rules WHERE active = true LIMIT 1');
    const rule = rulesRes.rows[0] || {
      sunset_window_start: '17:00:00',
      sunset_window_end: '20:00:00',
      sunset_hourly_surcharge: 500.00,
      weekend_multiplier: 1.10,
      vat_rate: 0.05,
      currency: 'AED'
    };

    const duration = parseFloat(durationHours) || 2;
    const guests = parseInt(guestCount, 10) || 1;
    const baseRate = parseFloat(yacht.base_hourly_rate) || 3500;

    // 2. Base charter price
    let baseCharter = baseRate * duration;

    // 3. Weekend surcharge check (Friday=5, Saturday=6, Sunday=0 in Dubai weekend luxury calendar)
    const dayOfWeek = startTime.getDay();
    const isWeekend = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0);
    let weekendSurcharge = 0;
    if (isWeekend && rule.weekend_multiplier > 1.0) {
      weekendSurcharge = Math.round(baseCharter * (parseFloat(rule.weekend_multiplier) - 1.0));
    }

    // 4. Sunset window premium check (17:00 - 20:00)
    let sunsetSurcharge = 0;
    const startHour = startTime.getHours() + (startTime.getMinutes() / 60);
    const endHour = endTime.getHours() + (endTime.getMinutes() / 60);
    // Overlap with [17:00, 20:00]
    const sunsetOverlap = Math.max(0, Math.min(endHour, 20) - Math.max(startHour, 17));
    if (sunsetOverlap > 0) {
      sunsetSurcharge = Math.round(sunsetOverlap * parseFloat(rule.sunset_hourly_surcharge));
    }

    // 5. Add-ons pricing
    const addonLineItems = [];
    let addonsTotal = 0;

    if (Array.isArray(selectedAddonCodes) && selectedAddonCodes.length > 0) {
      const addonsRes = await db.query('SELECT * FROM add_ons WHERE active = true');
      const allAddons = addonsRes.rows;

      for (const code of selectedAddonCodes) {
        const addon = allAddons.find(a => a.code === code || a.id === code);
        if (addon) {
          let lineTotal = 0;
          const unitPrice = parseFloat(addon.price);
          if (addon.pricing_type === 'FIXED') {
            lineTotal = unitPrice;
          } else if (addon.pricing_type === 'PER_GUEST') {
            lineTotal = unitPrice * guests;
          } else if (addon.pricing_type === 'PER_HOUR') {
            lineTotal = unitPrice * duration;
          }

          addonsTotal += lineTotal;
          addonLineItems.push({
            id: addon.id,
            code: addon.code,
            name: addon.name,
            pricingType: addon.pricing_type,
            unitPrice,
            totalPrice: lineTotal,
            requiresCrew: addon.requires_crew,
            taxable: addon.taxable
          });
        }
      }
    }

    // 6. Subtotal & UAE 5% VAT
    const subtotal = baseCharter + weekendSurcharge + sunsetSurcharge + addonsTotal;
    const vatRate = parseFloat(rule.vat_rate) || 0.05;
    const vatAmount = Math.round(subtotal * vatRate * 100) / 100;
    const grandTotal = Math.round((subtotal + vatAmount) * 100) / 100;

    return {
      currency: rule.currency || 'AED',
      baseHourlyRate: baseRate,
      durationHours: duration,
      baseCharter,
      isWeekend,
      weekendSurcharge,
      sunsetHours: sunsetOverlap,
      sunsetSurcharge,
      addonsTotal,
      addonLineItems,
      subtotal,
      vatRate,
      vatAmount,
      grandTotal,
      calculatedAt: new Date().toISOString()
    };
  }
}

module.exports = new PricingEngine();
