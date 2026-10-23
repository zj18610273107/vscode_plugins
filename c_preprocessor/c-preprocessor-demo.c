#define FEATURE_ALPHA 1
#define FEATURE_BETA 0
#define TARGET_LEVEL 2
#define USE_FAST_PATH 1
#define TEMP_FLAG 1

#ifdef FEATURE_ALPHA
int alpha_enabled = 1;
#else
int alpha_disabled = 1;
#endif

#if defined(FEATURE_ALPHA) && TARGET_LEVEL >= 2
int level_two_alpha = 1;
  #ifdef USE_FAST_PATH
  int fast_path = 1;
  #else
  int slow_path = 1;
  #endif
#elif defined(FEATURE_BETA)
int beta_fallback = 1;
#else
int no_feature = 1;
#endif

#ifndef DISABLE_LOGGING
int logging_enabled = 1;
  #if FEATURE_BETA
  int verbose_logging = 1;
  #else
  int compact_logging = 1;
  #endif
#endif

#undef TEMP_FLAG

#ifdef TEMP_FLAG
int temp_flag_enabled = 1;
#else
int temp_flag_disabled = 1;
#endif

/* Space between # and the directive keyword */
# if FEATURE_ALPHA
int spaced_if_active = 1;
# else
int spaced_if_inactive = 1;
# endif

# if FEATURE_BETA
int spaced_else_inactive = 1;
# else
int spaced_else_active = 1;
# endif
