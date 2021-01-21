
#include "bn.h"
#include "keccak256.h"

#include <inttypes.h>
#include <omp.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#else
#include <unistd.h>
#endif

#define WORD_BUFFER_BYTES (2 << 20) // 2 MB
#define WORD_BUFFER_LENGTH (WORD_BUFFER_BYTES / sizeof(struct bn))

#define SAMPLE_INDICES 10
#define READ_BUFSIZE 1024
#define ETH_HASH_SIZE 66
#define ETH_ADDRESS_SIZE 42
#define PERCENT_100 10000

#define THREAD_ITERATIONS 600000

#define HASH_REPORT_THRESHOLD 1

uint32_t coprimes[10];

uint32_t bignum_mod_small(struct bn *b, uint32_t m)
{
   // Compute b % m
   uint64_t tmp = 0;
   size_t i;
   for (int i = BN_ARRAY_SIZE - 1; i >= 0; i--)
   {
      tmp = (tmp << 32) | b->array[i];
      tmp %= m;
   }
   return (uint32_t)tmp;
}

void bignum_add_small(struct bn *b, uint32_t n)
{

   uint32_t tmp = b->array[0];
   b->array[0] += n;
   int i = 0;
   while (i < BN_ARRAY_SIZE - 1 && tmp > b->array[i])
   {
      tmp = b->array[i + 1];
      b->array[i + 1]++;
      i++;
   }
}

void init_work_constants()
{
   size_t i;

   coprimes[0] = 0x0000fffd;
   coprimes[1] = 0x0000fffb;
   coprimes[2] = 0x0000fff7;
   coprimes[3] = 0x0000fff1;
   coprimes[4] = 0x0000ffef;
   coprimes[5] = 0x0000ffe5;
   coprimes[6] = 0x0000ffdf;
   coprimes[7] = 0x0000ffd9;
   coprimes[8] = 0x0000ffd3;
   coprimes[9] = 0x0000ffd1;
}

struct work_data
{
   uint32_t x[10];
};

void init_work_data(struct work_data *wdata, struct bn *secured_struct_hash)
{
   size_t i;
   struct bn x;
   for (i = 0; i < 10; i++)
   {
      wdata->x[i] = bignum_mod_small(secured_struct_hash, coprimes[i]);
   }
}

/*
 * Solidity definition:
 *
 * address[] memory recipients,
 * uint256[] memory split_percents,
 * uint256 recent_eth_block_number,
 * uint256 recent_eth_block_hash,
 * uint256 target,
 * uint256 pow_height
 */
struct input_data
{
   char seed_str[ETH_HASH_SIZE + 1];
   char secured_hash_str[ETH_HASH_SIZE + 1];
   char target_str[ETH_HASH_SIZE + 1];
   char start_nonce_str[ETH_HASH_SIZE + 1];
   uint64_t thread_iterations;
   uint64_t hash_limit;
};

void read_data(struct input_data *d)
{
   char buf[READ_BUFSIZE] = {'\0'};

   int i = 0;
   do
   {
      int c;
      while ((c = getchar()) != '\n' && c != EOF)
      {
         if (i < READ_BUFSIZE)
         {
            buf[i++] = c;
         }
         else
         {
            fprintf(stderr, "[C] Buffer was about to overflow!");
         }
      }
   } while (strlen(buf) == 0 || buf[strlen(buf) - 1] != ';');

   fprintf(stderr, "[C] Buffer: %s\n", buf);
   sscanf(buf, "%66s %66s %66s %66s %" SCNu64 " %" SCNu64 "",
          d->seed_str,
          d->secured_hash_str,
          d->target_str,
          d->start_nonce_str,
          &d->thread_iterations,
          &d->hash_limit);

   fprintf(stderr, "[C] Seed:         %s\n", d->seed_str);
   fprintf(stderr, "[C] Secured hash: %s\n", d->secured_hash_str);
   fprintf(stderr, "[C] Difficulty:   %s\n", d->target_str);
   fprintf(stderr, "[C] Start Nonce:  %s\n", d->start_nonce_str);
   fprintf(stderr, "[C] Thread Iterations: %" PRIu64 "\n", d->thread_iterations);
   fprintf(stderr, "[C] Hash Limit: %" PRIu64 "\n", d->hash_limit);
   fflush(stderr);
}

void find_word(struct bn *result, uint32_t x, uint32_t *coefficients, struct bn *word_buffer)
{
   uint64_t y = coefficients[4];
   y *= x;
   y += coefficients[3];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[2];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[1];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[0];
   y %= WORD_BUFFER_LENGTH - 1;
   bignum_assign(result, word_buffer + y);
}

void find_and_xor_word(struct bn *result, uint32_t x, uint32_t *coefficients, struct bn *word_buffer)
{
   uint64_t y = coefficients[4];
   y *= x;
   y += coefficients[3];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[2];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[1];
   y %= WORD_BUFFER_LENGTH - 1;
   y *= x;
   y += coefficients[0];
   y %= WORD_BUFFER_LENGTH - 1;
   bignum_xor(result, word_buffer + y, result);
}

void work(struct bn *result, struct bn *secured_struct_hash, struct bn *nonce, struct bn *word_buffer)
{
   struct work_data wdata;
   init_work_data(&wdata, secured_struct_hash);

   bignum_assign(result, secured_struct_hash); // result = secured_struct_hash;

   uint32_t coefficients[5];

   int i;
   for (i = 0; i < sizeof(coefficients) / sizeof(uint32_t); ++i)
   {
      coefficients[i] = 1 + bignum_mod_small(nonce, coprimes[i]);
   }

   for (i = 0; i < sizeof(coprimes) / sizeof(uint32_t); ++i)
   {
      find_and_xor_word(result, wdata.x[i], coefficients, word_buffer);
   }
}

int words_are_unique(struct bn *secured_struct_hash, struct bn *nonce, struct bn *word_buffer)
{
   struct work_data wdata;
   struct bn w[sizeof(coprimes) / sizeof(uint32_t)];
   init_work_data(&wdata, secured_struct_hash);

   uint32_t coefficients[5];

   int i, j;
   for (i = 0; i < sizeof(coefficients) / sizeof(uint32_t); ++i)
   {
      coefficients[i] = 1 + bignum_mod_small(nonce, coprimes[i]);
   }

   for (i = 0; i < sizeof(coprimes) / sizeof(uint32_t); ++i)
   {
      find_word(w + i, wdata.x[i], coefficients, word_buffer);
      for (j = 0; j < i; j++)
      {
         if (bignum_cmp(w + i, w + j) == 0)
            return 0;
      }
   }
   return 1;
}

int main(int argc, char **argv)
{
#ifdef _WIN32
   _setmode(_fileno(stdin), _O_BINARY);
#endif

   struct bn *word_buffer = malloc(WORD_BUFFER_BYTES);
   struct bn bn_i;

   char bn_str[78];

   SHA3_CTX c;

   init_work_constants();

   while (true)
   {
      struct input_data input;

      read_data(&input);

      int j;

      struct bn seed, secured_hash, target, start_nonce;
      bignum_from_string(&seed, input.seed_str + 2, ETH_HASH_SIZE - 2);
      bignum_from_string(&secured_hash, input.secured_hash_str + 2, ETH_HASH_SIZE - 2);
      bignum_from_string(&target, input.target_str + 2, ETH_HASH_SIZE - 2);
      bignum_from_string(&start_nonce, input.start_nonce_str + 2, ETH_HASH_SIZE - 2);

      // Procedurally generate word buffer w[i] from a seed
      // Each word buffer element is computed by w[i] = H(seed, i)
      bignum_endian_swap(&seed);
      for (unsigned long i = 0; i < WORD_BUFFER_LENGTH; i++)
      {
         keccak_init(&c);
         keccak_update(&c, (unsigned char *)&seed, sizeof(seed));
         bignum_from_int(&bn_i, i);
         bignum_endian_swap(&bn_i);
         keccak_update(&c, (unsigned char *)&bn_i, sizeof(struct bn));
         keccak_final(&c, (unsigned char *)(word_buffer + i));
         bignum_endian_swap(word_buffer + i);
      }

      struct bn nonce, t_nonce, s_nonce;
      struct bn result, t_result;
      bool stop = false;

      bignum_assign(&nonce, &start_nonce);
      bignum_assign(&s_nonce, &nonce);
      uint32_t hash_report_counter = 0;
      time_t timer;
      struct tm *timeinfo;
      char time_str[20];

      uint64_t hashes = 0;

      bignum_init(&result);

#pragma omp parallel private(t_nonce, t_result)
      {
         while (!stop && hashes <= input.hash_limit)
         {
#pragma omp critical
            {
               if (omp_get_thread_num() == 0)
               {
                  if (hash_report_counter >= HASH_REPORT_THRESHOLD)
                  {
                     time(&timer);
                     timeinfo = localtime(&timer);
                     strftime(time_str, sizeof(time_str), "%FT%T", timeinfo);
                     fprintf(stdout, "H:%s %" PRId64 ";\n", time_str, hashes);
                     fflush(stdout);
                     hash_report_counter = 0;
                  }
                  else
                  {
                     hash_report_counter++;
                  }
               }
               bignum_assign(&t_nonce, &s_nonce);
               bignum_add_small(&s_nonce, input.thread_iterations);
               hashes += input.thread_iterations;
            }

            for (uint64_t i = 0; i < input.thread_iterations && !stop; i++)
            {
               work(&t_result, &secured_hash, &t_nonce, word_buffer);

               if (bignum_cmp(&t_result, &target) < 0)
               {
                  if (!words_are_unique(&secured_hash, &t_nonce, word_buffer))
                  {
                     // Non-unique, do nothing
                     // This is normal
                     fprintf(stderr, "[C] Possible proof failed uniqueness check\n");
                     bignum_inc(&t_nonce);
                  }
                  else
                  {
#pragma omp critical
                     {
                        // Two threads could find a valid proof at the same time (unlikely, but possible).
                        // We want to return the more difficult proof
                        if (!stop)
                        {
                           stop = true;
                           bignum_assign(&result, &t_result);
                           bignum_assign(&nonce, &t_nonce);
                        }
                        else if (bignum_cmp(&t_result, &result) < 0)
                        {
                           bignum_assign(&result, &t_result);
                           bignum_assign(&nonce, &t_nonce);
                        }
                     }
                  }
               }
               else
                  bignum_inc(&t_nonce);
            }
         }
      }

      if (bignum_is_zero(&result))
      {
         fprintf(stdout, "F:1;\n");

         fprintf(stderr, "[C] Finished without nonce\n");
         fflush(stderr);
      }
      else
      {
         bignum_to_string(&nonce, bn_str, sizeof(bn_str), false);
         fprintf(stdout, "N:%s;\n", bn_str);
         fprintf(stderr, "[C] Nonce: %s\n", bn_str);
         fflush(stderr);
      }

      fflush(stdout);
   }
}
