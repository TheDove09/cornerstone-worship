# Cornerstone Worship Team App — Setup Guide

This app works on iPhone, Android and computers. People "install" it from the web page
onto their home screen. Setup takes about 20 minutes, one time. Everything used here is **free**.

---

## How people get in

1. **You (a leader)** type the **church's CCLI / SongSelect email and password** into the app once
   (Me → Leader Settings → Set Up Church CCLI Login). The app saves only a scrambled lock-code made from
   the password, so nobody can read the password back.
2. **Each team member** taps **"Create my profile"** and enters their name, their own email and a password
   for this app. They also type the **church's CCLI login** once to prove they're on the team.
3. If it matches, they're in. The app remembers them, so they don't have to sign in every time.
4. 5 wrong guesses locks that person out for 15 minutes.
5. Leaders can remove anyone's access from **Me → Team Members**.
6. If the church ever changes its CCLI password, update it in Leader Settings. People already on the
   team stay in; new people use the new password.

> CCLI doesn't let outside apps log into SongSelect or copy its song catalog. So each song stores its
> **CCLI number**, and the **"Open in SongSelect"** button opens that song on SongSelect, where the church
> account is signed in.

---

## Step 1: Create the online database (Supabase, free)

1. Go to **supabase.com**, then **Start your project**, and sign up.
2. Click **New project**. Name it `cornerstone-worship`, make up a database password (save it somewhere)
   and pick the region closest to you. Wait about 2 minutes while it sets up.
3. In the left menu, click **SQL Editor**, then **New query**.
4. Open the file `supabase/schema.sql`, copy **everything**, paste it in, and click **Run**.
   It should say "Success".
5. Left menu: **Authentication → Sign In / Providers → Email**:
   - Leave **Email** turned ON.
   - Turn **"Confirm email" OFF**. This keeps sign-up simple for older members, and the church CCLI
     login is what keeps strangers out.
6. Left menu: **Project Settings → API** (or **Connect**). Copy two things:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long code). This key is safe to put in the app.
     **Never** use the `service_role` key.

## Step 2: Put those two values in the app

Open `js/config.js` and paste them in:

```js
SUPABASE_URL: 'https://abcd1234.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...the long key...',
```

(If you leave these empty, the app runs in **Demo Mode** with sample songs, so you can try it out.)

## Step 3: Put the app on the internet (Netlify, free)

1. Go to **app.netlify.com/drop** and make a free account.
2. Drag the whole **`cornerstone-worship` folder** onto the page.
3. You get a web address like `https://cornerstone-worship-123.netlify.app`.
   You can rename it in **Site settings → Change site name**.
4. Back in Supabase, go to **Authentication → URL Configuration** and set **Site URL** to that address
   (this makes the "forgot password" emails work).

To update the app later, drag the folder onto Netlify again (**Deploys** tab).

## Step 4: Make yourself and the other leader admins

1. Open the app's address, tap **Create my profile**, and fill it in. For the CCLI part, type anything for
   now (you'll land on the "One more step" screen; that's expected). Have the other leader do the same.
2. In Supabase, open **SQL Editor** and run this (with your two real emails):
   ```sql
   update public.profiles set role = 'admin'
   where email in ('you@example.com', 'otherleader@example.com');
   ```
3. Close and reopen the app. Go to **Me → Set Up Church CCLI Login** and enter the church's
   CCLI email and password.
4. Send the team the app link. 🎉

## Step 5: Install on each device

- **iPhone/iPad (Safari):** tap Share (the square with an up arrow), then **Add to Home Screen**, then **Add**.
- **Android (Chrome):** tap the **⋮** menu, then **Install app** (or **Add to Home screen**).
- **Computer (Chrome/Edge):** click the install icon at the right end of the address bar.

The **Me** tab in the app shows these same steps.

> iPhone note: the home-screen app has its own sign-in, separate from Safari, so people sign in
> once more after adding it.

---

## What's in the app now

| Tab | Everyone | Leaders also can… |
|---|---|---|
| **Home** | Next service + songs and keys, latest leader messages | Quick buttons: Plan a Service, Send a Message, Add a Song, Team |
| **Songs** | Search, see key/tempo/CCLI #, **Open in SongSelect**, **Share the key** by text/email | Add / edit / delete songs, send a key to the team in-app |
| **Sundays** | Upcoming & past set lists with big key badges, **Share by Text or Email** | Plan services, pick songs & keys, reorder, notes, **Send to Team** |
| **Messages** | Read leader messages | Write / delete messages |
| **Me** | Text size (Normal / Large / Extra Large), install help, sign out | Team Members, Church CCLI login |

## Coming next (when you're ready)

- Listen back to just the worship part of each service
- Full sermon audio

The database is ready for these. They'll use Supabase Storage for the audio files.
