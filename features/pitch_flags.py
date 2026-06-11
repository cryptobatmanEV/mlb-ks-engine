"""
Shared pitch-level and plate-appearance-level flag definitions, used by
pitcher_features.py, opponent_features.py, and park_factors.py so the
classification logic (whiff, chase, pitch mix, K/BB/hit events, ...) is
defined in exactly one place.
"""

# Descriptions where the batter swung the bat
SWING_DESCRIPTIONS = {
    'swinging_strike', 'swinging_strike_blocked', 'foul', 'foul_tip',
    'hit_into_play', 'foul_bunt', 'missed_bunt',
}
# Swings that missed entirely (whiffs)
WHIFF_DESCRIPTIONS = {'swinging_strike', 'swinging_strike_blocked', 'missed_bunt'}

# Statcast zone codes 11-14 are the four corners outside the strike zone
OOZ_ZONES = {11, 12, 13, 14}

# Pitch type groupings for pitch-mix features
FASTBALL_TYPES = {'FF', 'SI'}
SLIDER_TYPES = {'SL', 'ST', 'SV'}
CURVEBALL_TYPES = {'CU', 'KC', 'CS'}
CHANGEUP_TYPES = {'CH', 'FS', 'FO'}

# Plate-appearance-ending event classification
K_EVENTS = {'strikeout', 'strikeout_double_play'}
BB_EVENTS = {'walk', 'intent_walk'}
HIT_EVENTS = {'single', 'double', 'triple', 'home_run'}
SF_EVENTS = {'sac_fly', 'sac_fly_double_play'}
NON_AB_EVENTS = BB_EVENTS | SF_EVENTS | {
    'hit_by_pitch', 'sac_bunt', 'sac_bunt_double_play', 'catcher_interf',
}
TOTAL_BASES = {'single': 1, 'double': 2, 'triple': 3, 'home_run': 4}


def add_pitch_flags(df):
    """Add per-pitch boolean/numeric columns used for swing/chase/pitch-mix features."""
    df = df.copy()
    df['is_swing'] = df['description'].isin(SWING_DESCRIPTIONS)
    df['is_whiff'] = df['description'].isin(WHIFF_DESCRIPTIONS)
    df['is_called_strike'] = df['description'] == 'called_strike'
    df['is_ooz'] = df['zone'].isin(OOZ_ZONES)
    df['is_oz_swing'] = df['is_ooz'] & df['is_swing']
    df['is_first_pitch'] = df['pitch_number'] == 1
    df['is_first_pitch_strike'] = df['is_first_pitch'] & df['type'].isin(['S', 'X'])

    pt = df['pitch_type']
    df['is_fastball'] = pt.isin(FASTBALL_TYPES)
    df['is_slider'] = pt.isin(SLIDER_TYPES)
    df['is_curveball'] = pt.isin(CURVEBALL_TYPES)
    df['is_changeup'] = pt.isin(CHANGEUP_TYPES)
    df['is_other_pitch'] = pt.notna() & ~(
        df['is_fastball'] | df['is_slider'] | df['is_curveball'] | df['is_changeup']
    )
    df['fastball_velo'] = df['release_speed'].where(df['is_fastball'])
    return df


def add_event_flags(df):
    """Add plate-appearance-ending event flags (only meaningful on the PA-ending pitch row)."""
    df = df.copy()
    ev = df['events']
    df['is_pa'] = ev.notna() & (ev != 'truncated_pa')
    df['is_k'] = ev.isin(K_EVENTS)
    df['is_bb'] = ev.isin(BB_EVENTS)
    df['is_hbp'] = ev == 'hit_by_pitch'
    df['is_hit'] = ev.isin(HIT_EVENTS)
    df['is_sf'] = ev.isin(SF_EVENTS)
    df['is_ab'] = df['is_pa'] & ~ev.isin(NON_AB_EVENTS)
    df['total_bases'] = ev.map(TOTAL_BASES).fillna(0).where(df['is_pa'], 0)
    return df
