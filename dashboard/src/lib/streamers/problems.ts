export type StreamerProblem = {code:string;error:string;hint:string;status:number;field?:string;requestId?:string};
const problems:Record<string,[string,string,number]> = {
  provider_not_configured:['Платформа ще не підключена','Адміністратор сервера має додати ключі платформи в dashboard/.env.production і перевідтворити контейнер dashboard.',503],
  provider_configuration:['Некоректні налаштування API','Перевір ключ та дозволені API у кабінеті платформи.',502],
  provider_authorization:['Платформа відхилила доступ','Перевір ключі застосунку, дозволи API та строк дії токена автора.',502],
  provider_rate_limit:['Досягнуто ліміту платформи','Перевірки відновляться автоматично. Перевір квоту API перед повторним запуском.',429],
  provider_unavailable:['Платформа тимчасово недоступна','Наявні налаштування збережено. Перевірку буде повторено автоматично.',502],
  provider_schema:['Платформа повернула неповні дані','Стан ефіру не підтверджено. Система повторить перевірку.',502],
  provider_identity:['Канал не відповідає налаштуванням','Перевір посилання та дозвіл саме цього автора.',400],
  provider_timeout:['Платформа не встигла відповісти','Спробуй пізніше. Невдалий запит не підтверджує завершення ефіру.',504],
  channel_not_found:['Канал не знайдено','Перевір нік або посилання на вибраній платформі.',400],
  channel_video_url:['Це посилання на відео, а не на канал','Відкрий сторінку автора й скопіюй посилання з @handle або /channel/UC….',400],
  channel_resolution_required:['Потрібне пряме посилання на YouTube-канал','Відкрий старе посилання в браузері та скопіюй нову адресу з @handle або /channel/UC….',400],
  channel_invalid:['Некоректне посилання на канал','Вкажи HTTPS-посилання на канал або його нік. Для YouTube: @handle, нік, /channel/UC…, /user/… або /c/…. Посилання з si та вкладкою videos підтримуються.',400],
  duplicate_channel:['Цей канал уже додано','Відредагуй наявний канал замість створення копії.',409],
  revision_conflict:['Дані вже змінилися','Онови список і відкрий учасника повторно. Твою форму залишено відкритою.',409],
  account_limit:['Перевищено ліміт каналів','Можна зберегти до 30 каналів загалом і до 5 каналів YouTube.',400],
  invalid_input:['Перевір заповнення форми','Укажи Discord ID учасника та щонайменше одну платформу.',400],
  member_missing:['Учасника немає на Discord-сервері','Перевір Discord ID та членство. Його ефіри й нові сповіщення призупинено.',400],
  discord_401:['Discord відхилив токен бота','Перевір налаштування Discord-бота на сервері.',502],
  discord_403:['Боту бракує прав у Discord','Перевір перегляд каналу, надсилання повідомлень, вставку посилань і читання історії.',502],
  discord_404:['Учасник або канал Discord не знайдений','Перевір вибраний канал, Discord ID і сервер бота.',400],
  discord_429:['Discord обмежив частоту запитів','Черга повторить доставку після паузи.',429],
  discord_unavailable:['Discord тимчасово недоступний','Перевірка або доставка повториться автоматично.',502],
  tiktok_authorization_required:['Потрібен дозвіл автора TikTok','Додай access token і refresh token із дозволами user.info.basic, user.info.profile та video.list.',400],
  tiktok_token_invalid:['Не вдалося прочитати доступ TikTok','Перевір STREAMER_TOKEN_KEY або підключи автора повторно.',400],
  videos_unavailable:['Ефір перевірено, відео тимчасово недоступні','LIVE може показуватися. Читання нових відео буде повторено.',200],
  discovery_unavailable:['Пошук нових ефірів або відео затримується','Відомі ефіри перевіряються окремо. Перевір квоту й доступність платформи.',200],
  delivery_uncertain:['Перевіряємо результат надсилання','Discord міг прийняти повідомлення. Система шукає його перед можливим повтором.',200],
  delivery_unavailable:['Не вдалося підтвердити доставку','Подія залишилася в черзі. Дочекайся автоматичної звірки або повтору.',502],
  monitor_disabled:['Перевірку каналів вимкнено','Увімкни перевірку в налаштуваннях і збережи їх.',400],
  access_denied:['Немає доступу до керування','Потрібна активна сесія власника або адміністратора.',403],
  origin_rejected:['Запит відхилено','Відкрий налаштування з чинного домену дашборда.',403],
  rate_limit:['Забагато змін за короткий час','Зачекай кілька хвилин і повтори дію.',429],
  body_limit:['Форма завелика','Скороти кількість змін за один раз.',413],
  channels_unavailable:['Не вдалося завантажити канали Discord','Перевір доступ бота. Поточний вибір каналу збережено.',503],
  logs_unavailable:['Журнал тимчасово недоступний','Дані каналів доступні. Онови журнал пізніше.',503],
  storage_unavailable:['Не вдалося прочитати або зберегти дані','Перевір стан PostgreSQL і повтори дію.',503],
};
export class StreamerInputError extends Error {
  constructor(readonly code:string,readonly field?:string){super(code);}
}
export function streamerProblem(code:string,field?:string):StreamerProblem {
  const known=Object.hasOwn(problems,code)?code:'storage_unavailable';
  const [error,hint,status]=problems[known];return {code:known,error,hint,status,...(field?{field}:{})};
}
export function classifyStreamerError(error:unknown,fallback='storage_unavailable'):StreamerProblem {
  if(error instanceof StreamerInputError)return streamerProblem(error.code,error.field);
  const e=error as {message?:string;name?:string;status?:number};const message=typeof e?.message==='string'?e.message:'';
  if(e?.name==='DiscordRestError')return streamerProblem([401,403,404,429].includes(e.status||0)?'discord_'+e.status:'discord_unavailable');
  if(Object.hasOwn(problems,message))return streamerProblem(message);
  if(e?.name==='TimeoutError'||e?.name==='AbortError')return streamerProblem('provider_timeout');
  if(/уже змінено|вже змінено/.test(message))return streamerProblem('revision_conflict');
  if(/уже додано/.test(message))return streamerProblem('duplicate_channel');
  if(/Ліміт |Можна додати/.test(message))return streamerProblem('account_limit');
  if(/Канал (?:Twitch|YouTube) не знайдено/.test(message))return streamerProblem('channel_not_found');
  if(/^(?:Вкажи|Перевір нік|Це не|Посилання)/.test(message))return streamerProblem('channel_invalid');
  if(/^(?:Обери|Некоректн|Потрібен|Канал має|Офіційний|Перевір TikTok)/.test(message))return streamerProblem('invalid_input');
  if(/^TikTok:/.test(message))return streamerProblem('provider_identity');
  if(/^Для TikTok/.test(message))return streamerProblem('provider_not_configured');
  return streamerProblem(fallback);
}
