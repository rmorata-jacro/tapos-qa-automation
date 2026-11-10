/**
 * Selectable regions and timezones from GET /signup/api/options/ on
 * https://it.taposapp.com, observed 2026-11-10. Only the locales offered in
 * the response are included. Support email addresses from that response are
 * not stored here.
 */
export const OBSERVED_SIGNUP_REGIONS: readonly { code: string; label: string; timezones: readonly string[] }[] = [
  {
    "code": "AU",
    "label": "Australia",
    "timezones": [
      "Antarctica/Macquarie",
      "Australia/Adelaide",
      "Australia/Brisbane",
      "Australia/Broken_Hill",
      "Australia/Currie",
      "Australia/Darwin",
      "Australia/Eucla",
      "Australia/Hobart",
      "Australia/Lindeman",
      "Australia/Lord_Howe",
      "Australia/Melbourne",
      "Australia/Perth",
      "Australia/Sydney"
    ]
  },
  {
    "code": "GB",
    "label": "United Kingdom",
    "timezones": [
      "Europe/London"
    ]
  },
  {
    "code": "US",
    "label": "United States",
    "timezones": [
      "America/Adak",
      "America/Anchorage",
      "America/Boise",
      "America/Chicago",
      "America/Denver",
      "America/Detroit",
      "America/Indiana/Indianapolis",
      "America/Indiana/Knox",
      "America/Indiana/Marengo",
      "America/Indiana/Petersburg",
      "America/Indiana/Tell_City",
      "America/Indiana/Vevay",
      "America/Indiana/Vincennes",
      "America/Indiana/Winamac",
      "America/Juneau",
      "America/Kentucky/Louisville",
      "America/Kentucky/Monticello",
      "America/Los_Angeles",
      "America/Menominee",
      "America/Metlakatla",
      "America/New_York",
      "America/Nome",
      "America/North_Dakota/Beulah",
      "America/North_Dakota/Center",
      "America/North_Dakota/New_Salem",
      "America/Phoenix",
      "America/Sitka",
      "America/Yakutat",
      "Pacific/Honolulu"
    ]
  },
  {
    "code": "OTHER",
    "label": "Other",
    "timezones": [
      "Europe/London"
    ]
  }
];
