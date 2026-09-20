/**
 * Indian Market Hours Utility
 * Active Window: 9:00 AM to 3:30 PM IST (UTC+5:30)
 * Standard days: Monday to Sunday (Daily)
 */

export function isMarketHours(date = new Date(), allowWeekends = true, bufferMinutes = 0) {
  // Convert given date to IST
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000;
  const istDate = new Date(utcMs + 5.5 * 3600000);

  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const currentMinuteOfDay = hours * 60 + minutes;

  // 9:00 AM = 540 minutes
  // 3:30 PM (15:30) = 930 minutes (+ bufferMinutes)
  return currentMinuteOfDay >= 540 && currentMinuteOfDay <= (930 + bufferMinutes);
}

export function isMarketOrGraceHours(date = new Date()) {
  return isMarketHours(date, true, 5); // Includes 5-min post-market grace until 3:35 PM IST
}

export function getMarketStatus(date = new Date()) {
  const active = isMarketHours(date);
  return {
    isMarketHours: active,
    window: '9:00 AM - 3:30 PM IST (Daily)',
    timezone: 'Asia/Kolkata (UTC+5:30)',
  };
}
