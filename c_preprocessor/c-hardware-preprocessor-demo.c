/* Terminal starts hardware test console. */
#define HARDWARE_TEST_DEBUG_MODE_CTRL 0

#if HARDWARE_TEST_DEBUG_MODE_CTRL == 0
  #define HARDWARE_TEST_TIMEOUT_START_RUN 1800 /* 30 minutes, no operation starts */
  #define HARDWARE_LOOPS 999
#else
  #define HARDWARE_TEST_TIMEOUT_START_RUN 10 /* 30 seconds */
  #define HARDWARE_LOOPS 3
#endif
