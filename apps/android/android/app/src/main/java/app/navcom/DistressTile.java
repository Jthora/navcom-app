package app.navcom;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Distress from the lock screen (2026-11-04): a Quick Settings tile, which Android shows with the
 * phone locked. A tap opens NavCom on its Distress screen over the lock screen; it sends nothing.
 * Sending is still the hold, there as everywhere [invariant 3: always deliberate], and the screen
 * shows what happened as it always does [invariant 2].
 *
 * Over the lock screen it is the Distress screen and nothing else: {@link MainActivity} puts the app
 * back behind the lock the moment anything else opens, so a locked phone shows nobody the rest.
 */
public class DistressTile extends TileService {

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        // An action, not a switch: it is never "on".
        tile.setState(Tile.STATE_INACTIVE);
        tile.setLabel(getString(R.string.distress_tile));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(getString(R.string.app_name));
        tile.updateTile();
    }

    @Override
    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    public void onClick() {
        Intent intent = new Intent(this, MainActivity.class)
            .setAction(MainActivity.ACTION_DISTRESS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startActivityAndCollapse(
                PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT)
            );
        } else {
            startActivityAndCollapse(intent);
        }
    }
}
