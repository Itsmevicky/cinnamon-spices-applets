export {}; // Declaring as a Module

function importModule(path: string): any {
    if (typeof require !== 'undefined') {
      return require('./' + path);
    } else {
      if (!AppletDir) var AppletDir = imports.ui.appletManager.applets['weather@mockturtl'];
      return AppletDir[path];
    }
}

const UUID = "weather@mockturtl"
imports.gettext.bindtextdomain(UUID, imports.gi.GLib.get_home_dir() + "/.local/share/locale");
function _(str: string): string {
  return imports.gettext.dgettext(UUID, str)
}

// Unable to use type declarations with imports like this, so
// typing it manually again.
var utils = importModule("utils");
var isCoordinate = utils.isCoordinate as (text: any) => boolean;
var isLangSupported = utils.isLangSupported as (lang: string, languages: Array <string> ) => boolean;
var FahrenheitToKelvin = utils.FahrenheitToKelvin as (fahr: number) => number;
var CelsiusToKelvin = utils.CelsiusToKelvin as (celsius: number) => number;
var MPHtoMPS = utils.MPHtoMPS as (speed: number) => number;
var icons = utils.icons;
var IsNight = utils.IsNight as (sunTimes: SunTimes, date?: Date) => boolean;
var weatherIconSafely = utils.weatherIconSafely as (code: string[], icon_type: imports.gi.St.IconType) => string;
var Sentencify = utils.Sentencify as (words: string[]) => string;

//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////
///////////                                       ////////////
///////////                DarkSky                ////////////
///////////                                       ////////////
//////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////

class DarkSky implements WeatherProvider {

    //--------------------------------------------------------
    //  Properties
    //--------------------------------------------------------
	public readonly prettyName = "DarkSky";
	public readonly name = "DarkSky";
    public readonly maxForecastSupport = 8;
    public readonly supportsHourly = false;
    public readonly website = "https://darksky.net/poweredby/";
    public readonly maxHourlyForecastSupport = 168;

    private descriptionLinelength = 25;
    private supportedLanguages = [
        'ar', 'az', 'be', 'bg', 'bs', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es',
        'et', 'fi', 'fr', 'he', 'hr', 'hu', 'id', 'is', 'it', 'ja', 'ka', 'ko',
        'kw', 'lv', 'nb', 'nl', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr',
        'sv', 'tet', 'tr', 'uk', 'x-pig-latin', 'zh', 'zh-tw'];

    private query = "https://api.darksky.net/forecast/";

      // DarkSky Filter words for short conditions, won't work on every language
    private DarkSkyFilterWords = [_("and"), _("until"), _("in"), _("Possible")];
    
    private unit: queryUnits = null;

    private app: WeatherApplet

    constructor(_app: WeatherApplet) {
        this.app = _app;
    }

    //--------------------------------------------------------
    //  Functions
    //--------------------------------------------------------
    public async GetWeather(): Promise<WeatherData> {
        let query = this.ConstructQuery();
        let json;
        if (query != "" && query != null) {
            this.app.log.Debug("DarkSky API query: " + query);
            try {
                json = await this.app.LoadJsonAsync(query);
            }
            catch(e) {
                this.app.HandleHTTPError("darksky", e, this.app, this.HandleHTTPError);
                return null;
            }        
            
            if (!json) {
                this.app.HandleError({type: "soft", detail: "no api response", service: "darksky"});
                return null;
            }
         
            if (!json.code) {                   // No code, Request Success
                return this.ParseWeather(json);
            }
            else {
                this.HandleResponseErrors(json);
                return null;
            }
        }
        return null;
    };


    private ParseWeather(json: DarkSkyPayload): WeatherData {
        try {
            let sunrise = new Date(json.daily.data[0].sunriseTime * 1000);
            let sunset = new Date(json.daily.data[0].sunsetTime * 1000)
            let result: WeatherData = {
                date: new Date(json.currently.time * 1000),
                coord: {
                    lat: json.latitude,
                    lon: json.longitude
                },
                location: {
                    url: "https://darksky.net/forecast/" + json.latitude + "," + json.longitude,
                    timeZone: json.timezone,
                },
                sunrise: sunrise,
                sunset: sunset,
                wind: {
                    speed: this.ToMPS(json.currently.windSpeed),
                    degree: json.currently.windBearing
                },
                temperature: this.ToKelvin(json.currently.temperature),
                pressure: json.currently.pressure,
                humidity: json.currently.humidity * 100,
                condition: {
                    main: this.GetShortCurrentSummary(json.currently.summary),
                    description: json.currently.summary,
                    icon: weatherIconSafely(this.ResolveIcon(json.currently.icon, {sunrise: sunrise, sunset: sunset}), this.app.config.IconType()),
                    customIcon: this.ResolveCustomIcon(json.currently.icon)
                },
                extra_field: {
                    name: _("Feels Like"),
                    value: this.ToKelvin(json.currently.apparentTemperature),
                    type: "temperature"
                },
				forecasts: [],
				hourlyForecasts: []
            }
            // Forecast
            for (let i = 0; i < json.daily.data.length; i++) {
                let day = json.daily.data[i];
                let forecast: ForecastData = {          
                    date: new Date(day.time * 1000),         
                      temp_min: this.ToKelvin(day.temperatureLow),           
                      temp_max: this.ToKelvin(day.temperatureHigh),           
                    condition: {
                      main: this.GetShortSummary(day.summary),               
                      description: this.ProcessSummary(day.summary),        
                      icon: weatherIconSafely(this.ResolveIcon(day.icon), this.app.config.IconType()),    
                      customIcon: this.ResolveCustomIcon(day.icon)           
                    },
                  };

                  // JS assumes time is local, so it applies the correct offset creating the Date (including Daylight Saving)
                  // but when using the date when daylight saving is active, it DOES NOT apply the DST back,
                  // So we offset the date to make it Noon
                  forecast.date.setHours(forecast.date.getHours() + 12);

                  result.forecasts.push(forecast);
			}

			for (let i = 0; i < json.hourly.data.length; i++) {
                let hour = json.hourly.data[i];
                let forecast: HourlyForecastData = {          
                    date: new Date(hour.time * 1000),         
					temp: this.ToKelvin(hour.temperature),                  
                    condition: {
                      main: this.GetShortSummary(hour.summary),               
                      description: this.ProcessSummary(hour.summary),        
                      icon: weatherIconSafely(this.ResolveIcon(hour.icon, {sunrise: sunrise, sunset: sunset}, new Date(hour.time * 1000)), this.app.config.IconType()),    
                      customIcon: this.ResolveCustomIcon(hour.icon)           
					},
					precipation: {
						type: hour.precipType as PrecipationType,
						volume: hour.precipProbability,
						chance: hour.precipProbability * 100
					}
				};

				result.hourlyForecasts.push(forecast);
			}
			

            return result;
        }
        catch(e) {
            this.app.log.Error("DarkSky payload parsing error: " + e)
            this.app.HandleError({type: "soft", detail: "unusal payload", service: "darksky", message: _("Failed to Process Weather Info")});
            return null;
        }
    };

    private ConvertToAPILocale(systemLocale: string) {
        if (systemLocale == "zh-tw") {
          return systemLocale;
        }
        let lang = systemLocale.split("-")[0];
        return lang;
    }

    private ConstructQuery(): string {
        this.SetQueryUnit();
        let query;
        let key = this.app.config._apiKey.replace(" ", "");
        let location = this.app.config._location.replace(" ", "");
        if (this.app.config.noApiKey()) {
            this.app.log.Error("DarkSky: No API Key given");
            this.app.HandleError({
                type: "hard",
                 userError: true,
                  "detail": "no key",
                   message: _("Please enter API key in settings,\nor get one first on https://darksky.net/dev/register")});
            return "";
        }
        if (isCoordinate(location)) {
            query = this.query + key + "/" + location + 
            "?exclude=minutely,flags" + "&units=" + this.unit;
            let locale = this.ConvertToAPILocale(this.app.currentLocale);
            if (isLangSupported(locale, this.supportedLanguages) && this.app.config._translateCondition) {
                query = query + "&lang=" + locale;
            }
            return query;
        }
        else {
            this.app.log.Error("DarkSky: Location is not a coordinate");
            this.app.HandleError({type: "hard", detail: "bad location format", service:"darksky", userError: true, message: ("Please Check the location,\nmake sure it is a coordinate") })
            return "";
        }
    };


    private HandleResponseErrors(json: any): void {
        let code = json.code;
        let error = json.error;
        let errorMsg = "DarkSky API: "
        this.app.log.Debug("DarksSky API error payload: " + json);
        switch(code) {
            case "400":
                this.app.log.Error(errorMsg + error);
                break;
            default:
                this.app.log.Error(errorMsg + error);
                break
        }
    };

    /** Handles API Scpecific HTTP errors  */
    public HandleHTTPError(error: HttpError, uiError: AppletError): AppletError {
        if (error.code == 403) { // DarkSky returns auth error on the http level when key is wrong
            uiError.detail = "bad key"
            uiError.message = _("Please Make sure you\nentered the API key correctly and your account is not locked");
            uiError.type = "hard";
            uiError.userError = true;
        }
        if (error.code == 401) { // DarkSky returns auth error on the http level when key is wrong
            uiError.detail = "no key"
            uiError.message = _("Please Make sure you\nentered the API key what you have from DarkSky");
            uiError.type = "hard";
            uiError.userError = true;
        }
        return uiError;
    }

    private ProcessSummary(summary: string): string {
        let processed = summary.split(" ");
        let result = "";
        let linelength = 0;
        for (let i = 0; i < processed.length; i++) {
            if (linelength + processed[i].length > this.descriptionLinelength) {
                result = result + "\n";
                linelength = 0;
            }
            result = result + processed[i] + " ";
            linelength = linelength + processed[i].length + 1;
        }
        return result;
    };

    private GetShortSummary(summary: string): string {
		let processed = summary.split(" ");
		if (processed.length == 1) return processed[0];
        let result: string[] = [];
        for (let i = 0; i < processed.length; i++) {
            if (!/[\(\)]/.test(processed[i]) && !this.WordBanned(processed[i])) {
                result.push(processed[i]) + " ";
			}
			if (result.length == 2) break;
        }
        return Sentencify(result);
	};

    private GetShortCurrentSummary(summary: string): string {
        let processed = summary.split(" ");
        let result = "";
        let maxLoop;
        (processed.length < 2) ? maxLoop = processed.length : maxLoop = 2;
        for (let i = 0; i < maxLoop; i++) {
            if (processed[i] != "and") {
                result = result + processed[i] + " ";
            }
        }
        return result;
    }

    private WordBanned(word: string): boolean {
        return this.DarkSkyFilterWords.indexOf(word) != -1;
    }

    private ResolveIcon(icon: string, sunTimes?: SunTimes, date?: Date): string[] {
        switch (icon) {
            case "rain":
              return [icons.rain, icons.showers_scattered, icons.rain_freezing]
            case "snow":
              return [icons.snow]
            case "sleet":
              return [icons.rain_freezing, icons.rain, icons.showers_scattered]
            case "fog":
              return [icons.fog]
            // There is no guarantee that there is a wind icon
            case "wind":
                return (sunTimes && IsNight(sunTimes, date)) ? ["weather-windy", "wind", "weather-breeze", icons.clouds, icons.few_clouds_night] : ["weather-windy", "wind", "weather-breeze", icons.clouds, icons.few_clouds_day]
            case "cloudy":/* mostly cloudy (day) */
              return (sunTimes && IsNight(sunTimes, date)) ? [icons.overcast, icons.clouds, icons.few_clouds_night] : [icons.overcast, icons.clouds, icons.few_clouds_day]
            case "partly-cloudy-night":
              return [icons.few_clouds_night]
            case "partly-cloudy-day":
              return [icons.few_clouds_day]
            case "clear-night":
              return [icons.clear_night]
            case "clear-day":
              return [icons.clear_day]
            // Have not seen Storm or Showers icons returned yet
            case "storm":
              return [icons.storm]
            case "showers":
              return [icons.showers, icons.showers_scattered]
            default:
              return [icons.alert]
          }
    };

    private ResolveCustomIcon(icon: string): CustomIcons {
        switch (icon) {
            case "rain":
              return "rain-symbolic";
            case "snow":
              return "snow-symbolic";
            case "fog":
              return "fog-symbolic";
            case "cloudy":
              return "cloudy-symbolic";
            case "partly-cloudy-night":
              return "night-alt-cloudy-symbolic";
            case "partly-cloudy-day":
              return "day-cloudy-symbolic";
            case "clear-night":
              return "night-clear-symbolic";
            case "clear-day":
              return "day-sunny-symbolic";
            // Have not seen Storm or Showers icons returned yet
            case "storm":
              return "thunderstorm-symbolic";
            case "showers":
              return "showers-symbolic";
            // There is no guarantee that there is a wind icon
            case "wind":
                return "strong-wind-symbolic";
            default:
              return "cloud-refresh-symbolic";
          }
    }

    private SetQueryUnit(): void {
        if (this.app.config._temperatureUnit == "celsius"){
            if (this.app.config._windSpeedUnit == "kph" || this.app.config._windSpeedUnit == "m/s") {
                this.unit = 'si';
            }
            else {
                this.unit = 'uk2';
            }
        }
        else {
            this.unit = 'us';
        }
    };

    private ToKelvin(temp: number): number {
        if (this.unit == 'us') {
            return FahrenheitToKelvin(temp);
        }
        else {
            return CelsiusToKelvin(temp);
        }

    };

    private ToMPS(speed: number): number {
        if (this.unit == 'si') {
            return speed;
        }
        else {
            return MPHtoMPS(speed);
        }
    };
};

/**
 * - 'si' returns meter/sec and Celsius
 * - 'us' returns miles/hour and Farhenheit
 * - 'uk2' return miles/hour and Celsius
 */
type queryUnits = 'si' | 'us' | 'uk2';

interface DarkSkyHourlyPayload {
	time: number;
	summary: string;
	icon: string;
	precipIntensity: number;
	precipProbability: number;
	precipType: string;
	temperature: number;
	apparentTemperature: number;
	dewPoint: number;
	humidity: number;
	pressure: number;
	windSpeed: number;
	windGust: number;
	windBearing: number;
	cloudCover: number;
	uvIndex: number;
	visibility: number;
	ozone: number;
}

interface DarkSkyDailyPayload {
	time: number;
	summary: string;
	icon: string;
	sunriseTime: number;
	sunsetTime: number;
	moonPhase: number;
	precipIntensity: number;
	precipIntensityMax: number;
	precipIntensityMaxTime: number;
	precipProbability: number;
	precipType: string;
	temperatureHigh: number;
	temperatureHighTime: number;
	temperatureLow: number;
	temperatureLowTime: number;
	apparentTemperatureHigh: number;
	apparentTemperatureHighTime: number;
	apparentTemperatureLow: number;
	apparentTemperatureLowTime: number;
	dewPoint: number;
	humidity: number;
	pressure: number;
	windSpeed: number;
	windGust: number;
	windGustTime: number;
	windBearing: number;
	cloudCover: number;
	uvIndex: number;
	uvIndexTime: number;
	visibility: number;
	ozone: number;
	temperatureMin: number;
	temperatureMinTime: number;
	temperatureMax: number;
	temperatureMaxTime: number;
	apparentTemperatureMin: number;
	apparentTemperatureMinTime: number;
	apparentTemperatureMax: number;
	apparentTemperatureMaxTime: number;
}
interface DarkSkyPayload {
	latitude: number;
	longitude: number;
	timezone: string;
	currently: {
		/** Unix timestamp in seconds */
		time: number;
		summary: string;
		icon: string;
		nearestStormDistance: number;
        nearestStormBearing: number;
        precipIntensity: number;
        precipProbability: number;
        temperature: number;
        apparentTemperature: number;
        dewPoint: number;
        humidity: number;
        pressure: number;
        windSpeed: number;
        windGust: number;
        windBearing: number;
        cloudCover: number;
        uvIndex: number;
        visibility: number;
        ozone: number;
    },
    hourly: {
        summary: string;
        icon: string;
        data: DarkSkyHourlyPayload[];
	}
	daily: {
        summary: string;
        icon: string;
		data: DarkSkyDailyPayload[]
	}
}

