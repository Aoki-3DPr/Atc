#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

bool range_check(ll i, ll j, ll h, ll w) {
	return (i >= 0 && j >= 0 && i < h && j < w);
}

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n; cin >> n;
	vector<pair<string, string>> aa;
	map<string, ll> a, b;
	for (ll i=0 ; i < n; i++) {
		string x, y; cin >> x >> y;
		aa.emplace_back(x, y);
		a[x]++;
		b[y]++;
	}
	for (ll i = 0; i < n; i++) {
		if (aa[i].first == aa[i].second) {
			if (a[aa[i].first] <= 1 && b[aa[i].second] <= 1) {

			} else {
				cout << "No" << endl;
				return 0;
			}
		} else {
			if (a[aa[i].first] <= 1 && b[aa[i].first] <= 0 || a[aa[i].second] <= 0 && b[aa[i].second] <= 1) {

			} else {
				cout << "No" << endl;
				return  0;
			}
		}
	}
	cout << "Yes" << endl;
	return 0;
}

int main() {
	solve();
    return 0;
}

