package com.nexit.app;
import android.content.BroadcastReceiver;import android.content.Context;import android.content.Intent;
public class BootReceiver extends BroadcastReceiver{ @Override public void onReceive(Context c,Intent i){String json=c.getSharedPreferences("nexit",Context.MODE_PRIVATE).getString("state","");if(!json.isEmpty())AlarmScheduler.scheduleAll(c,json);} }
