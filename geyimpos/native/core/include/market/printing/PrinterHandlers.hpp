#pragma once
#include "market/db/Database.hpp"
#include "market/ipc/StdioServer.hpp"

namespace market::printing {

/**
 * Registers the printing RPCs: find printers, choose one, send bytes to it.
 *
 * Printing used to live entirely in Electron, where the only sink that existed
 * wrote the bytes to a file - the till said the receipt printed and nothing
 * came out. The device work is here instead because it is Win32 (setupapi,
 * winspool, raw device handles, a socket sweep) and because the chosen printer
 * belongs in the database next to the rest of the till's configuration.
 *
 * Electron still builds the ESC/POS bytes; it now hands them here to be sent.
 */
void registerPrinterHandlers(ipc::StdioServer& server, db::Database& db);

}  // namespace market::printing
