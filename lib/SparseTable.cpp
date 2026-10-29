#pragma once
#include <bits/stdc++.h>
#define ll long long

using namespace std;
int di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
int dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

bool range_check(int i, int j, int h, int w) { return 0 <= j && j < w && 0 <= i && i < h; }

class SparseTable {
private:
	ll size = 0;
	ll depth = 0;
	ll identity;
	vector<ll> table_index;
	function<ll(ll a, ll b)> f;
	vector<vector<ll>> table;

	ll createTable(ll table, ll depth, vector<ll> v) {
		for (ll i = 0; i < depth; i++) {

		}
	}

public:
	SparseTable(ll n, function<ll(ll a, ll b)> func, ll identity, vector<ll> v) :
	f(std::move(func)), identity(identity) {
		do {
			size = 1 << depth;
			depth++;
			table_index.push_back(size);
		} while (size < n);
		table.resize(depth);

	}


};


#ifdef BUILDING_LIB_STANDALONE
int main() {
	return 0;
}
#endif
