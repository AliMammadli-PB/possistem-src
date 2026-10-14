#define CATCH_CONFIG_MAIN
#include "catch_amalgamated.hpp"

#include <cstdlib>

// The fixtures build on the demo catalogue, which a real install no longer
// gets by default (POS_SEED_DEMO_MENU, Migrator.cpp). Set before main runs.
namespace {
const bool kDemoMenu = [] {
#ifdef _WIN32
    return _putenv_s("POS_SEED_DEMO_MENU", "1") == 0;
#else
    return setenv("POS_SEED_DEMO_MENU", "1", 1) == 0;
#endif
}();
}  // namespace
